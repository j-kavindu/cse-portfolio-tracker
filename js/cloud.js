/* Firestore adapter. Firebase modules are loaded once by the static site's module script. */
(function (global) {
  "use strict";
  const STORES = ["transactions", "instruments", "dividends", "cashAdjustments", "targets", "portfolioHistory", "settings"];
  let sdk, database, uid;
  const configured = () => {
    const c = global.APP_CONFIG && global.APP_CONFIG.firebase;
    return !!(c && c.apiKey && c.projectId && c.appId && !Object.values(c).some(v => String(v).startsWith("YOUR_")));
  };
  function init(modules, db) { sdk = modules; database = db; }
  function setUser(value) { uid = value || null; }
  function ready() { if (!configured() || !sdk || !database || !uid) throw new Error("Cloud unavailable"); }
  function key(store, record) {
    if (!STORES.includes(store)) throw new Error("Unknown store");
    const value = store === "instruments" || store === "targets" ? record.symbol : store === "settings" ? record.key : record.id;
    if (value === undefined || value === null || String(value).includes("/")) throw new Error("Invalid document key");
    return String(value);
  }
  function collection(store) { return sdk.collection(database, "users", uid, store); }
  async function pullAll() {
    ready(); const data = {};
    for (const store of STORES) data[store] = (await sdk.getDocs(collection(store))).docs.map(d => d.data());
    return data;
  }
  async function pushRecord(store, record) { ready(); await sdk.setDoc(sdk.doc(collection(store), key(store, record)), record); }
  async function deleteRecord(store, value) { ready(); await sdk.deleteDoc(sdk.doc(collection(store), String(value))); }
  async function wipeAll() {
    ready();
    for (const store of STORES) {
      const docs = (await sdk.getDocs(collection(store))).docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = sdk.writeBatch(database);
        for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
    }
  }
  async function replaceAll(data) {
    ready();
    for (const store of STORES) if (!Array.isArray(data[store])) throw new Error("Invalid backup: " + store);
    // Compare keys per collection; batches stay below Firestore's write limit.
    for (const store of STORES) {
      const existing = (await sdk.getDocs(collection(store))).docs;
      const desired = new Map(data[store].map(row => [key(store, row), row]));
      const changes = existing.filter(d => !desired.has(d.id)).map(d => ["delete", d.ref]);
      for (const [id, row] of desired) changes.push(["set", sdk.doc(collection(store), id), row]);
      for (let i = 0; i < changes.length; i += 400) {
        const batch = sdk.writeBatch(database);
        for (const [type, ref, row] of changes.slice(i, i + 400)) type === "delete" ? batch.delete(ref) : batch.set(ref, row);
        await batch.commit();
      }
    }
  }
  global.Cloud = { init, setUser, pullAll, pushRecord, deleteRecord, replaceAll, wipeAll, isOnline: () => navigator.onLine, isConfigured: configured, key };
})(window);
