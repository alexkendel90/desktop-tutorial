// Hintergrundprozess Spracherkennung (Whisper über transformers.js) – läuft auch als lokale Datei (file://)
const V = '3.8.1';
const CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${V}/dist/`;
const LIB = ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
const post = (m) => self.postMessage(m);

// ---- Speicher (IndexedDB): Programm und Modelle werden nur einmal geladen
let dbp = null;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('diktat-einfach', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('files', mode); const q = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Speichern abgebrochen (Speicher voll?)'));
  });
}
const getFile = (k) => idb('readonly', s => s.get(k)).catch(() => undefined);
const putFile = (k, v) => idb('readwrite', s => s.put(v, k));
const allKeys = () => idb('readonly', s => s.getAllKeys()).catch(() => []);
const modelKey = (url) => { const m = /^https:\/\/huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+)$/.exec(String(url)); return m ? `modelle/${m[1]}/${m[2]}` : null; };
const manifestKey = (m) => `manifest/${m}.json`;

// Offline: Netzwerkfehler bei Modelldateien als 404 melden
const missing = new Set();
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  try { return await realFetch(input, init); }
  catch (e) { const k = modelKey(typeof input === 'string' ? input : input.url); if (k) { missing.add(k); return new Response(null, { status: 404, statusText: 'offline' }); } throw e; }
};

async function download(url, label) {
  let r;
  try { r = await realFetch(url); } catch (e) { throw new Error(`Keine Internetverbindung – „${label}“ ist noch nicht gespeichert. Beim ersten Start wird einmal Internet gebraucht.`); }
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status}): ${label}`);
  const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), chunks = []; let loaded = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); loaded += value.length; post({ type: 'progress', file: label, loaded, total }); }
  return new Blob(chunks);
}
async function getLib(name) {
  let b = await getFile('lib/' + name);
  if (!b) { b = await download(CDN + name, name); await putFile('lib/' + name, b); }
  return b;
}

// ---- Whisper
let T = null, W = null, loadedModel = null;
const THREADS = self.crossOriginIsolated ? Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8)) : 1;

async function loadLib(used) {
  if (!T) {
    post({ type: 'phase', text: 'Lade Programm …' });
    const [lib, mjs, wasm] = await Promise.all(LIB.map(getLib));
    T = await import(URL.createObjectURL(new Blob([lib], { type: 'text/javascript' })));
    const o = T.env.backends.onnx;
    o.wasm.wasmPaths = {
      mjs: URL.createObjectURL(new Blob([mjs], { type: 'text/javascript' })),
      wasm: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
    };
    o.wasm.numThreads = THREADS; o.wasm.proxy = false;
    T.env.allowLocalModels = false; T.env.allowRemoteModels = true;
    T.env.useBrowserCache = false; T.env.useCustomCache = true;
  }
  T.env.customCache = {
    async match(url) { const k = modelKey(url); if (!k) return; const b = await getFile(k); if (!b) return; used.add(k); return new Response(b, { headers: { 'content-length': String(b.size) } }); },
    async put(url, resp) { const k = modelKey(url); if (!k) return; await putFile(k, await resp.blob()); used.add(k); },
  };
}

async function load(id, opts) {
  if (loadedModel === id) return;
  const used = new Set(); missing.clear();
  await loadLib(used);
  post({ type: 'phase', text: 'Lade Sprachmodell …' });
  const progress_callback = (p) => { if (p.status === 'progress' && p.total) post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); };
  if (W) { try { await W.model.dispose(); } catch (e) {} W = null; }
  try {
    const [processor, tokenizer, model] = await Promise.all([
      T.AutoProcessor.from_pretrained(id, { progress_callback }),
      T.AutoTokenizer.from_pretrained(id, { progress_callback }),
      T.WhisperForConditionalGeneration.from_pretrained(id, { device: opts.device, dtype: opts.dtype, progress_callback }),
    ]);
    W = { processor, tokenizer, model };
  } catch (e) {
    if (missing.size) throw new Error('Das Modell ist noch nicht offline gespeichert. Beim ersten Start wird einmal Internet gebraucht.');
    throw e;
  }
  loadedModel = id;
  await putFile(manifestKey(id), new Blob([JSON.stringify([...used])]));
}

async function transcribe(audio, lang, terms) {
  const { processor, tokenizer, model } = W;
  const inputs = await processor(audio);
  const gc = model.generation_config;
  const init = [gc.decoder_start_token_id, gc.lang_to_id[`<|${lang}|>`], gc.task_to_id.transcribe, gc.no_timestamps_token_id];
  let dec = init;
  if (terms) {
    // Glossar als „vorheriger Text“: Whisper schreibt diese Wörter dann bevorzugt so
    const prev = tokenizer.model.convert_tokens_to_ids(['<|startofprev|>'])[0];
    const ids = tokenizer.encode(' ' + terms, { add_special_tokens: false }).slice(-150);
    if (prev != null && ids.length) dec = [prev, ...ids, ...init];
  }
  const out = await model.generate({ ...inputs, decoder_input_ids: dec, max_new_tokens: Math.min(440 - dec.length, Math.ceil(audio.length / 16000 * 8) + 16) });
  return tokenizer.decode(out.tolist()[0].map(Number).slice(dec.length), { skip_special_tokens: true }).trim();
}

// ---- Warteschlange: fertige Sätze vor Live-Vorschau, von der Vorschau nur die neueste
const jobs = []; let running = false;
async function pump() {
  if (running) return; running = true;
  while (jobs.length) {
    let i = jobs.findIndex(j => !j.live); if (i < 0) i = 0;
    const j = jobs.splice(i, 1)[0];
    try { post({ type: 'result', id: j.id, live: j.live, text: await transcribe(j.audio, j.lang, j.terms) }); }
    catch (e) { post({ type: 'error', op: 'transcribe', id: j.id, live: j.live, text: e.message || String(e) }); }
  }
  running = false;
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'status') {
      const keys = new Set(await allKeys()), out = {};
      for (const id of m.models) {
        let ok = false;
        if (keys.has(manifestKey(id))) { try { const l = JSON.parse(await (await getFile(manifestKey(id))).text()); ok = l.length > 0 && l.every(k => keys.has(k)); } catch (e) {} }
        out[id] = ok && LIB.every(f => keys.has('lib/' + f));
      }
      post({ type: 'status', models: out });
    } else if (m.type === 'load') { await load(m.model, m.opts); post({ type: 'ready', model: m.model }); }
    else if (m.type === 'transcribe') {
      if (m.live) for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].live) jobs.splice(i, 1);
      jobs.push(m); pump();
    }
  } catch (e) { post({ type: 'error', op: m.type, text: (e && e.message) || String(e) }); }
};
