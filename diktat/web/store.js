// Gemeinsamer Datei-Speicher für die Hintergrundprozesse (IndexedDB).
// Modelle werden einmal von Hugging Face geladen und danach offline aus dem Browserspeicher gelesen.

let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('diktat-web', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Speichern abgebrochen (Speicher voll?)'));
  });
}
export const getFile = (k) => idb('readonly', s => s.get(k)).catch(() => undefined);
export const putFile = (k, v) => idb('readwrite', s => s.put(v, k));
export const allKeys = () => idb('readonly', s => s.getAllKeys()).catch(() => []);
export const clearAll = () => idb('readwrite', s => s.clear());

export const post = (msg) => self.postMessage(msg);

// Hugging-Face-URL -> Speicher-Schlüssel
export function modelKey(url) {
  const m = /^https:\/\/huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+)$/.exec(String(url));
  return m ? `modelle/${m[1]}/${m[2]}` : null;
}
export const manifestKey = (m) => `manifest/${m.replace(/[:/]/g, '_')}.json`;

export async function readManifest(model) {
  const b = await getFile(manifestKey(model));
  if (!b) return null;
  try { return JSON.parse(await b.text()); } catch (e) { return null; }
}
export async function writeManifest(model, keys) {
  await putFile(manifestKey(model), new Blob([JSON.stringify([...keys])], { type: 'application/json' }));
}

// Offline: Netzwerkfehler bei Modelldateien als 404 melden (optionale Dateien werden dann übersprungen).
export const missingOffline = new Set();
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  try { return await realFetch(input, init); }
  catch (e) {
    const url = typeof input === 'string' ? input : input.url;
    const k = modelKey(url);
    if (k) { missingOffline.add(k); return new Response(null, { status: 404, statusText: 'offline' }); }
    throw e;
  }
};

// Download mit Fortschritt; große Dateien in Teil-Blobs, damit nicht alles im Arbeitsspeicher liegt.
export async function download(url, label, optional = false) {
  const resp = await fetch(url);
  if (resp.statusText === 'offline' && !optional) throw new Error(`Keine Internetverbindung – „${label}“ ist noch nicht offline gespeichert. Bitte einmal mit Internet laden.`);
  if (optional && resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Download fehlgeschlagen (${resp.status}): ${label}`);
  const total = +resp.headers.get('content-length') || 0;
  const reader = resp.body.getReader();
  const parts = []; let chunks = []; let chunkBytes = 0; let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); chunkBytes += value.length; loaded += value.length;
    if (chunkBytes > 32 * 1048576) { parts.push(new Blob(chunks)); chunks = []; chunkBytes = 0; }
    post({ type: 'progress', file: label, loaded, total });
  }
  parts.push(new Blob(chunks));
  return new Blob(parts);
}

export async function fetchStored(key, url, label, optional = false) {
  let blob = await getFile(key);
  if (!blob) {
    blob = await download(url, label, optional);
    if (blob) await putFile(key, blob);
  }
  return blob;
}

// transformers.js: Modelldateien über IndexedDB zwischenspeichern; benutzte Dateien merken (Manifest)
export function useStoreForTransformers(T, usedKeys) {
  T.env.allowLocalModels = false;
  T.env.allowRemoteModels = true;
  T.env.useBrowserCache = false;
  T.env.useCustomCache = true;
  T.env.customCache = {
    async match(url) {
      const key = modelKey(url);
      if (!key) return undefined;
      const blob = await getFile(key);
      if (!blob) return undefined;
      usedKeys.add(key);
      return new Response(blob, { headers: { 'content-length': String(blob.size) } });
    },
    async put(url, response) {
      const key = modelKey(url);
      if (!key) return;
      await putFile(key, await response.blob());
      usedKeys.add(key);
    },
  };
}

export const THREADS = self.crossOriginIsolated
  ? Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8))
  : 1;

export async function hasWebGPU() {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

export async function modelStatus(models) {
  const keys = new Set(await allKeys());
  const out = {};
  for (const m of models) {
    const list = keys.has(manifestKey(m)) ? await readManifest(m) : null;
    out[m] = !!(list && list.length && list.every(k => keys.has(k)));
  }
  return out;
}
