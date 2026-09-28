const DB_NAME = 'pantry-tracker';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('items')) {
          db.createObjectStore('items', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('無法開啟資料庫'));
      };
    });
  }
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('資料讀寫失敗'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('資料寫入中斷'));
    tx.onerror = () => reject(tx.error || new Error('資料寫入失敗'));
  });
}

function toStoredItem(item) {
  return {
    id: item.id,
    name: item.name,
    expiry: item.expiry || null,
    area: item.area,
    leadDays: item.leadDays,
    photoId: item.photoId || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function loadAll() {
  const db = await openDb();
  const items = await requestToPromise(db.transaction('items').objectStore('items').getAll());
  const photos = await requestToPromise(db.transaction('photos').objectStore('photos').getAll());
  const photoMap = new Map(photos.map((photo) => [photo.id, photo.blob]));
  return items
    .map((item) => ({
      ...item,
      photoBlob: item.photoId ? photoMap.get(item.photoId) || null : null,
    }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function saveItem(item, photoBlob) {
  const db = await openDb();
  const existing = await requestToPromise(db.transaction('items').objectStore('items').get(item.id));
  const stored = toStoredItem(item);
  const tx = db.transaction(['items', 'photos'], 'readwrite');
  const photos = tx.objectStore('photos');

  if (photoBlob instanceof Blob) {
    const photoId = stored.photoId || existing?.photoId || crypto.randomUUID();
    stored.photoId = photoId;
    photos.put({ id: photoId, blob: photoBlob });
    if (existing?.photoId && existing.photoId !== photoId) photos.delete(existing.photoId);
  } else if (photoBlob === null) {
    const previous = stored.photoId || existing?.photoId;
    if (previous) photos.delete(previous);
    stored.photoId = null;
  } else if (!stored.photoId && existing?.photoId) {
    stored.photoId = existing.photoId;
  }

  tx.objectStore('items').put(stored);
  await transactionDone(tx);
  return stored;
}

export async function deleteItem(id) {
  const db = await openDb();
  const existing = await requestToPromise(db.transaction('items').objectStore('items').get(id));
  const tx = db.transaction(['items', 'photos'], 'readwrite');
  tx.objectStore('items').delete(id);
  if (existing?.photoId) tx.objectStore('photos').delete(existing.photoId);
  await transactionDone(tx);
}
