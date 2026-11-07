// Hintergrundprozess KI-Textverbesserung: kleines Sprachmodell (Qwen 2.5) lokal im Browser.
import * as T from './lib/transformers/transformers.min.js';
import { post, writeManifest, useStoreForTransformers, missingOffline, THREADS, hasWebGPU } from './store.js';

const onnx = T.env.backends.onnx;
onnx.wasm.wasmPaths = new URL('./lib/transformers/', import.meta.url).href;
onnx.wasm.numThreads = THREADS;
onnx.wasm.proxy = false;

let gen = null, genModel = null, device = null;
let stopper = null;

async function load(modelId) {
  if (gen && genModel === modelId) { post({ type: 'ready', model: modelId, device }); return; }
  if (gen) { try { await gen.dispose(); } catch (e) {} gen = null; genModel = null; }
  const gpu = await hasWebGPU();
  device = gpu ? 'webgpu' : 'wasm';
  const used = new Set();
  useStoreForTransformers(T, used);
  missingOffline.clear();
  post({ type: 'phase', text: `Lade KI-Modell (${gpu ? 'Grafikkarte' : 'Prozessor – langsam'}) …` });
  try {
    gen = await T.pipeline('text-generation', modelId, {
      dtype: gpu ? 'q4f16' : 'q4',
      device,
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
      },
    });
  } catch (e) {
    if (missingOffline.size) throw new Error('Das KI-Modell ist noch nicht offline gespeichert. Bitte einmal mit Internet laden.');
    throw e;
  }
  genModel = modelId;
  // Manifest pro Gerätetyp (WebGPU/CPU nutzen unterschiedliche Dateien)
  await writeManifest(modelId + (gpu ? '' : ':cpu'), used);
  post({ type: 'ready', model: modelId, device });
}

async function run(id, system, text) {
  stopper = new T.InterruptableStoppingCriteria();
  const messages = [{ role: 'system', content: system }, { role: 'user', content: text }];
  let acc = '';
  const streamer = new T.TextStreamer(gen.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (t) => { acc += t; post({ type: 'token', id, text: acc }); },
  });
  const t0 = performance.now();
  const out = await gen(messages, {
    max_new_tokens: Math.min(2048, Math.ceil(text.length / 2.5) + 200),
    do_sample: false,
    repetition_penalty: 1.05,
    streamer,
    stopping_criteria: stopper,
  });
  const last = out?.[0]?.generated_text;
  const final = Array.isArray(last) ? last.at(-1).content : acc;
  post({ type: 'done', id, text: (final || acc).trim(), ms: performance.now() - t0 });
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') await load(msg.model);
    else if (msg.type === 'run') await run(msg.id, msg.system, msg.text);
    else if (msg.type === 'stop') stopper?.interrupt();
  } catch (e) {
    post({ type: 'error', op: msg.type, id: msg.id, text: (e && e.message) || String(e) });
  }
};
