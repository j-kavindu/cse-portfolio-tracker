/*
 * db.js — IndexedDB persistence layer.
 * All methods return Promises. This is the only file that touches
 * `indexedDB` directly; everything else works with plain arrays/objects.
 */
(function (global) {
  "use strict";

  const DB_VERSION = 1;
  const STORES = ["transactions", "instruments", "dividends", "cashAdjustments", "targets", "portfolioHistory", "settings"];

  let dbName = "cse-portfolio-tracker"; // default namespace before login
  let dbPromise = null;
  let cloudUser = false;
  let pending = [];
  let syncBusy = false;
  let flushPromise = Promise.resolve();
  let initialSyncOk = false;
  const status = value => { const el = document.getElementById("sync-status"); if (el) el.textContent = value; };
  const hasRows = data => STORES.some(store => data[store].length);
  function queue(action) {
    if (!cloudUser) return;
    pending.push(action);
    localStorage.setItem("cse-pending__" + dbName, JSON.stringify(pending));
    status("Offline — changes saved locally");
    if (navigator.onLine) flush();
  }
  async function flush() {
    if (syncBusy) return flushPromise;
    if (!cloudUser || !navigator.onLine) return;
    syncBusy = true; status("Syncing…");
    flushPromise = (async () => { try {
      while (pending.length) {
        const [action, store, value] = pending[0];
        if (action === "put") await Cloud.pushRecord(store, value);
        else if (action === "delete") await Cloud.deleteRecord(store, value);
        else if (action === "replace") await Cloud.replaceAll(value);
        else if (action === "wipe") await Cloud.wipeAll();
        pending.shift();
        localStorage.setItem("cse-pending__" + dbName, JSON.stringify(pending));
      }
      status("Synced");
    } catch (e) { status(navigator.onLine ? "Sync error" : "Offline — changes saved locally"); }
    finally { syncBusy = false; } })();
    return flushPromise;
  }
  window.addEventListener("online", flush);
  window.addEventListener("offline", () => { if (cloudUser) status("Offline — changes saved locally"); });

  /** Give each signed-in user their own local database, keyed by their Firebase UID. */
  function setUser(userKey) {
    const safeKey = String(userKey || "guest").replace(/[^a-zA-Z0-9_@.-]/g, "_");
    const nextName = "cse-portfolio-tracker__" + safeKey;
    if (nextName !== dbName) {
      dbName = nextName;
      dbPromise = null; // force reopen against the new namespace
      initialSyncOk = false;
      cloudUser = !!(global.Cloud && global.Cloud.isConfigured() && userKey !== "local-demo");
      Cloud.setUser(cloudUser ? userKey : null);
      try { pending = JSON.parse(localStorage.getItem("cse-pending__" + dbName) || "[]"); } catch (_) { pending = []; }
    }
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("transactions")) {
          db.createObjectStore("transactions", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("instruments")) {
          db.createObjectStore("instruments", { keyPath: "symbol" });
        }
        if (!db.objectStoreNames.contains("dividends")) {
          db.createObjectStore("dividends", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("cashAdjustments")) {
          db.createObjectStore("cashAdjustments", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("targets")) {
          db.createObjectStore("targets", { keyPath: "symbol" });
        }
        if (!db.objectStoreNames.contains("portfolioHistory")) {
          db.createObjectStore("portfolioHistory", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, mode);
          const store = t.objectStore(storeName);
          const result = fn(store);
          t.oncomplete = () => resolve(result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  function getAll(storeName) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, "readonly");
          const req = t.objectStore(storeName).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function put(storeName, value) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, "readwrite");
          const req = t.objectStore(storeName).put(value);
          req.onsuccess = () => { const result = req.result; t.oncomplete = () => { queue(["put", storeName, { ...value, [storeName === "instruments" || storeName === "targets" ? "symbol" : storeName === "settings" ? "key" : "id"]: result }]); resolve(result); }; };
          req.onerror = () => reject(req.error);
        })
    );
  }

  function remove(storeName, key) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, "readwrite");
          const req = t.objectStore(storeName).delete(key);
          t.oncomplete = () => { queue(["delete", storeName, key]); resolve(); };
          req.onerror = () => reject(req.error);
        })
    );
  }

  function clearStore(storeName) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, "readwrite");
          const req = t.objectStore(storeName).clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  async function getAllData() {
    const data = {};
    for (const s of STORES) data[s] = await getAll(s);
    return data;
  }

  async function localReplace(data) {
    for (const s of STORES) {
      await clearStore(s);
      for (const row of data[s]) await localPut(s, row);
    }
  }
  function localPut(store, value) { return tx(store, "readwrite", objectStore => objectStore.put(value)); }
  async function replaceAllData(data) {
    for (const s of STORES) if (!Array.isArray(data[s])) throw new Error("Missing backup store: " + s);
    await localReplace(data);
    queue(["replace", null, data]);
  }
  async function wipeAllData() {
    for (const s of STORES) await clearStore(s);
    queue(["wipe"]);
  }
  async function syncWithCloud() {
    if (!cloudUser) return;
    if (!navigator.onLine) { status("Offline — changes saved locally"); return; }
    status("Syncing…");
    try {
      // Apply durable offline operations before pulling; never overwrite unsynced edits.
      if (pending.length) { await flush(); if (pending.length) return; }
      const local = await getAllData();
      const remote = await Cloud.pullAll();
      if (hasRows(remote)) await localReplace(remote);
      else if (hasRows(local)) await Cloud.replaceAll(local);
      initialSyncOk = true;
      status("Synced");
    } catch (e) { initialSyncOk = false; status("Sync error"); }
  }

  async function getSetting(key, fallback) {
    const rows = await getAll("settings");
    const row = rows.find((r) => r.key === key);
    return row ? row.value : fallback;
  }

  function setSetting(key, value) {
    return put("settings", { key, value });
  }

  const DB = {
    STORES,
    setUser,
    getAll,
    put,
    remove,
    clearStore,
    getAllData,
    replaceAllData,
    wipeAllData,
    getSetting,
    setSetting,
    syncWithCloud,
    flush,
    isInitialSyncOk: () => initialSyncOk,
  };

  global.DB = DB;
})(window);
