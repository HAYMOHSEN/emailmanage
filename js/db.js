/* ============================================================
   db.js — tiny IndexedDB wrapper (emails, attachment blobs, kv)
   ============================================================ */
(function (global) {
  'use strict';
  const NAME = 'email-management', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('emails')) {
          const s = db.createObjectStore('emails', { keyPath: 'id' });
          s.createIndex('status', 'status');
          s.createIndex('dueAt', 'dueAt');
          s.createIndex('fingerprint', 'fingerprint');
        }
        if (!db.objectStoreNames.contains('files')) {
          const f = db.createObjectStore('files', { keyPath: 'id' });
          f.createIndex('emailId', 'emailId');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      try { result = fn(s, t); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    }));
  }
  const wrap = (req) => ({ __req: req });

  const DB = {
    getAllEmails: () => tx('emails', 'readonly', s => wrap(s.getAll())),
    getEmail: (id) => tx('emails', 'readonly', s => wrap(s.get(id))),
    putEmail: (e) => tx('emails', 'readwrite', s => { s.put(e); return e; }),
    putEmails: (list) => tx('emails', 'readwrite', s => { list.forEach(e => s.put(e)); return list.length; }),
    deleteEmail: (id) => open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(['emails', 'files'], 'readwrite');
      t.objectStore('emails').delete(id);
      const idx = t.objectStore('files').index('emailId');
      const req = idx.openCursor(IDBKeyRange.only(id));
      req.onsuccess = () => { const c = req.result; if (c) { c.delete(); c.continue(); } };
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    })),
    putFile: (f) => tx('files', 'readwrite', s => { s.put(f); return f.id; }),
    putFiles: (list) => tx('files', 'readwrite', s => { list.forEach(f => s.put(f)); return list.length; }),
    getFile: (id) => tx('files', 'readonly', s => wrap(s.get(id))),
    getFilesFor: (emailId) => tx('files', 'readonly', s => wrap(s.index('emailId').getAll(IDBKeyRange.only(emailId)))),
    getAllFiles: () => tx('files', 'readonly', s => wrap(s.getAll())),
    kvGet: (key) => tx('kv', 'readonly', s => wrap(s.get(key))).then(r => r ? r.value : undefined),
    kvSet: (key, value) => tx('kv', 'readwrite', s => { s.put({ key, value }); return true; }),
    kvDel: (key) => tx('kv', 'readwrite', s => { s.delete(key); return true; }),
    clearAll: () => open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(['emails', 'files', 'kv'], 'readwrite');
      t.objectStore('emails').clear(); t.objectStore('files').clear(); t.objectStore('kv').clear();
      t.oncomplete = () => resolve(true); t.onerror = () => reject(t.error);
    }))
  };
  global.DB = DB;
})(window);
