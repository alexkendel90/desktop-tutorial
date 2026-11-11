// Hintergrundprozess Spracherkennung: Whisper (transformers.js) oder Parakeet v3 (parakeet.js).
// Jede Familie bekommt einen eigenen Worker, weil beide eine eigene ONNX-Runtime-Version mitbringen.
import {
  post, fetchStored, readManifest, writeManifest, useStoreForTransformers,
  missingOffline, THREADS, hasWebGPU, modelStatus, allKeys,
} from './store.js';

const LIB = new URL('./lib/', import.meta.url).href;

let loadedModel = null;
let W = null;      // { model, processor, tokenizer } für Whisper
let pk = null;     // ParakeetModel

// ---------------- Whisper ----------------
async function loadWhisper(modelId, opts = {}) {
  post({ type: 'phase', text: 'Lade Programmbibliothek …' });
  const T = await import('./lib/transformers/transformers.min.js');
  const onnx = T.env.backends.onnx;
  onnx.wasm.wasmPaths = LIB + 'transformers/';
  onnx.wasm.numThreads = THREADS;
  onnx.wasm.proxy = false;
  const used = new Set();
  useStoreForTransformers(T, used);
  missingOffline.clear();

  post({ type: 'phase', text: 'Lade Sprachmodell …' });
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
  };
  try {
    const [processor, tokenizer, model] = await Promise.all([
      T.AutoProcessor.from_pretrained(modelId, { progress_callback }),
      T.AutoTokenizer.from_pretrained(modelId, { progress_callback }),
      T.WhisperForConditionalGeneration.from_pretrained(modelId, { dtype: opts.dtype || 'q8', device: opts.device || 'wasm', progress_callback }),
    ]);
    W = { processor, tokenizer, model };
  } catch (e) {
    if (missingOffline.size) throw new Error('Das Modell ist noch nicht offline gespeichert. Bitte einmal mit Internet laden.');
    throw e;
  }
  await writeManifest(modelId, used);
}

async function whisperTranscribe(audio, lang, terms) {
  const { processor, tokenizer, model } = W;
  const inputs = await processor(audio);
  const gc = model.generation_config;
  const init = [gc.decoder_start_token_id, gc.lang_to_id[`<|${lang}|>`], gc.task_to_id.transcribe, gc.no_timestamps_token_id];
  let dec = init;
  if (terms) {
    // Fachbegriffe als "vorheriger Text" mitgeben: Whisper schreibt sie dann bevorzugt richtig
    const prev = tokenizer.model.convert_tokens_to_ids(['<|startofprev|>'])[0];
    const ids = tokenizer.encode(' ' + terms, { add_special_tokens: false }).slice(-150);
    if (prev != null && ids.length) dec = [prev, ...ids, ...init];
  }
  const maxNew = Math.min(440 - dec.length, Math.ceil(audio.length / 16000 * 8) + 16);
  const out = await model.generate({ ...inputs, decoder_input_ids: dec, max_new_tokens: maxNew });
  const seq = out.tolist()[0].map(Number).slice(dec.length);
  return tokenizer.decode(seq, { skip_special_tokens: true }).trim();
}

// ---------------- Parakeet v3 ----------------
const PK_REPO = 'ysdede/parakeet-tdt-0.6b-v3-onnx';
const PK_FILES = {
  cpu: { encoder: 'encoder-model.int8.onnx', decoder: 'decoder_joint-model.int8.onnx' },
  gpu: { encoder: 'encoder-model.onnx', decoder: 'decoder_joint-model.int8.onnx' },
};
async function loadParakeet(model) {
  const variant = model.split(':')[1];
  if (variant === 'gpu' && !(await hasWebGPU())) throw new Error('Keine WebGPU-fähige Grafikkarte gefunden. Bitte „Parakeet v3 CPU“ wählen.');
  post({ type: 'phase', text: 'Lade Programmbibliothek (Parakeet) …' });
  const ort = await import('./lib/ort/ort.bundle.min.mjs');
  ort.env.wasm.wasmPaths = LIB + 'ort/';
  ort.env.wasm.numThreads = THREADS;
  ort.env.wasm.proxy = false;
  globalThis.__ORT_MODULE__ = ort;   // parakeet.js holt sich ONNX Runtime von hier
  const PK = await import('./lib/parakeet.bundle.js');

  post({ type: 'phase', text: 'Lade Sprachmodell (Parakeet v3) …' });
  const f = PK_FILES[variant];
  const base = `https://huggingface.co/${PK_REPO}/resolve/main/`;
  const key = (n) => `modelle/${PK_REPO}/${n}`;
  const manifest = await readManifest(model);
  const get = (n, optional) => (optional && manifest && !manifest.includes(key(n)))
    ? null : fetchStored(key(n), base + n, n, optional);
  const vocab = await get('vocab.txt');
  const encoder = await get(f.encoder);
  const encoderData = await get(f.encoder + '.data', true);
  const decoder = await get(f.decoder);
  const decoderData = await get(f.decoder + '.data', true);

  post({ type: 'phase', text: 'Starte Parakeet v3 … (beim ersten Mal kann das dauern)' });
  const url = (b) => b ? URL.createObjectURL(b) : undefined;
  pk = await PK.ParakeetModel.fromUrls({
    encoderUrl: url(encoder), decoderUrl: url(decoder), tokenizerUrl: url(vocab),
    encoderDataUrl: url(encoderData), decoderDataUrl: url(decoderData),
    filenames: { encoder: f.encoder, decoder: f.decoder },
    backend: variant === 'gpu' ? 'webgpu-hybrid' : 'wasm',
    preprocessorBackend: 'js', nMels: 128, cpuThreads: THREADS,
  });
  const keys = [key('vocab.txt'), key(f.encoder), key(f.decoder)];
  if (encoderData) keys.push(key(f.encoder + '.data'));
  if (decoderData) keys.push(key(f.decoder + '.data'));
  await writeManifest(model, keys);
}

// ---------------- Warteschlange ----------------
// Endgültige Abschnitte haben Vorrang; von Live-Vorschauen wird nur die neueste behalten.
const jobs = [];
let running = false;
function enqueue(job) {
  if (job.live) {
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].live) jobs.splice(i, 1);
  }
  jobs.push(job);
  pump();
}
async function pump() {
  if (running) return;
  running = true;
  while (jobs.length) {
    let i = jobs.findIndex(j => !j.live);
    if (i < 0) i = 0;
    const job = jobs.splice(i, 1)[0];
    const t0 = performance.now();
    try {
      const text = pk
        ? ((await pk.transcribe(job.audio, 16000, { returnTimestamps: false, enableProfiling: false }))?.utterance_text || '')
        : await whisperTranscribe(job.audio, job.lang, job.terms);
      post({ type: 'result', id: job.id, live: job.live, text, ms: performance.now() - t0, seconds: job.audio.length / 16000 });
    } catch (e) {
      post({ type: 'error', op: 'transcribe', id: job.id, live: job.live, text: e.message || String(e) });
    }
  }
  running = false;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      if (loadedModel !== msg.model) {
        if (msg.model.startsWith('parakeet:')) await loadParakeet(msg.model);
        else await loadWhisper(msg.model, msg.opts);
        loadedModel = msg.model;
      }
      post({ type: 'ready', model: msg.model, threads: THREADS });
    } else if (msg.type === 'transcribe') {
      enqueue(msg);
    } else if (msg.type === 'status') {
      const keys = await allKeys();
      let est = null; try { est = await navigator.storage.estimate(); } catch (e) {}
      post({ type: 'status', models: await modelStatus(msg.models), usage: est && est.usage, count: keys.length });
    }
  } catch (e) {
    post({ type: 'error', op: msg.type, text: (e && e.message) || String(e) });
  }
};
