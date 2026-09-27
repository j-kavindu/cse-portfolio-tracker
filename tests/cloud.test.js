/* Small deterministic-key and ownership smoke test without Firebase credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = { APP_CONFIG: { firebase: { apiKey: 'test', projectId: 'test', appId: 'test', authDomain: 'test' } } };
vm.runInNewContext(fs.readFileSync('js/cloud.js', 'utf8'), { window, navigator: { onLine: true } });
const cloud = window.Cloud;
assert.equal(cloud.key('transactions', { id: 42 }), '42');
assert.equal(cloud.key('instruments', { symbol: 'JKH.N0000' }), 'JKH.N0000');
assert.equal(cloud.key('settings', { key: 'fee' }), 'fee');
assert.throws(() => cloud.key('transactions', {}));
assert.throws(() => cloud.key('targets', { symbol: 'a/b' }));
let writes = [];
const sdk = {
  collection: (...parts) => parts.join('/'),
  doc: (path, id) => `${path}/${id}`,
  setDoc: async (path, record) => writes.push([path, record]),
  deleteDoc: async path => writes.push([path, null])
};
cloud.init(sdk, 'db');
cloud.setUser('firebase-uid-123');
(async () => {
  await cloud.pushRecord('transactions', { id: 42, amount: 10 });
  await cloud.deleteRecord('transactions', 42);
  assert.equal(writes[0][0], 'db/users/firebase-uid-123/transactions/42');
  assert.equal(writes[0][1].id, 42);
  assert.equal(writes[1][0], writes[0][0]);
  let inFlight = 0, peak = 0;
  sdk.getDocs = async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    return { docs: [] };
  };
  const empty = await cloud.pullAll();
  assert.equal(Object.keys(empty).length, 7);
  assert.equal(peak, 7, 'Firestore collections should load concurrently');
  console.log('Cloud key/UID checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
