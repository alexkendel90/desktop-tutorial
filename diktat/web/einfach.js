// Diktat (einfach): Sprache -> Text, wortgetreu, offline. Nach jedem Diktat wird der Text in die Zwischenablage kopiert.
const $ = (id) => document.getElementById(id);
const SR = 16000;

// Bestes Modell, das auf diesem Gerät sinnvoll läuft:
// mit Grafikkarte (WebGPU + fp16) Whisper Large v3 Turbo, sonst Whisper Small auf dem Prozessor.
const MODELS = {
  turbo: {
    id: 'onnx-community/whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', where: 'Grafikkarte', size: '≈ 1,3 GB',
    opts: { device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' } },
  },
  small: {
    id: 'Xenova/whisper-small', name: 'Whisper Small', where: 'Prozessor', size: '≈ 250 MB',
    opts: { device: 'wasm', dtype: 'q8' },
  },
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('einfach.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('einfach.' + k, v); } catch (e) {} },
};

function setStatus(text, kind) {
  $('statusText').textContent = text;
  $('statusDot').className = 'dot' + (kind ? ' ' + kind : '');
}
const fmtMB = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : (b / 1048576).toFixed(0) + ' MB';

// ---------------------------------------------------------------- Modell
let model = null, worker = null, ready = false, loading = false;

async function pickModel() {
  const forced = store.get('model', '');
  if (MODELS[forced]) return MODELS[forced];
  try {
    const a = navigator.gpu && await navigator.gpu.requestAdapter();
    if (a && a.features.has('shader-f16')) return MODELS.turbo;
  } catch (e) {}
  return MODELS.small;
}

function startWorker() {
  worker?.terminate();
  worker = new Worker('asr-worker.js', { type: 'module' });
  worker.onmessage = onMessage;
  worker.onerror = (e) => fail(e.message || 'Hintergrundprozess abgestürzt (zu wenig Arbeitsspeicher?)');
}

function load() {
  if (loading) return;
  loading = true;
  fileProgress.clear();
  $('downloadBtn').disabled = true;
  setStatus('Lade Spracherkennung …', 'warn');
  worker.postMessage({ type: 'load', model: model.id, opts: model.opts });
}

function fail(text) {
  loading = false;
  $('progress').style.display = 'none';
  // Grafikkarten-Modell klappt nicht -> automatisch auf das Prozessor-Modell ausweichen
  if (model === MODELS.turbo && !/Internet|offline/i.test(text)) {
    store.set('model', 'small');
    model = MODELS.small;
    $('msg').textContent = 'Das Grafikkarten-Modell lief hier nicht, ich nehme Whisper Small.';
    startWorker(); showModel(); worker.postMessage({ type: 'status', models: [model.id] });
    return;
  }
  setStatus('Fehler', 'err');
  $('setup').style.display = 'block';
  $('msg').textContent = text;
  $('msg').className = 'small err-t';
  $('downloadBtn').disabled = false;
}

function showModel() {
  $('modelInfo').textContent = `${model.name} · ${model.where}`;
  $('setupText').textContent =
    `Für die Spracherkennung wird einmalig das Modell ${model.name} (${model.size}) aus dem Internet geladen und im Browser gespeichert. ` +
    'Danach funktioniert alles offline – deine Sprache verlässt das Gerät nie.';
  $('downloadBtn').textContent = `${model.name} herunterladen (${model.size})`;
}

const fileProgress = new Map();
function onMessage(ev) {
  const m = ev.data;
  switch (m.type) {
    case 'status':
      if (m.models[model.id]) load();
      else { $('setup').style.display = 'block'; setStatus('Einrichtung nötig', 'warn'); }
      break;
    case 'phase': setStatus(m.text, 'warn'); break;
    case 'progress': {
      fileProgress.set(m.file, m);
      let loaded = 0, total = 0;
      for (const v of fileProgress.values()) { loaded += v.loaded; total += v.total || v.loaded; }
      $('progress').style.display = 'block';
      $('progress').firstElementChild.style.width = (total ? 100 * loaded / total : 0).toFixed(1) + '%';
      $('msg').className = 'small';
      $('msg').textContent = `Lade … ${fmtMB(loaded)}${total ? ' von ' + fmtMB(total) : ''}`;
      break;
    }
    case 'ready':
      loading = false; ready = true;
      $('setup').style.display = 'none';
      $('recBtn').disabled = false;
      setStatus(recording ? 'Aufnahme läuft' : 'Bereit', recording ? 'rec' : 'ok');
      break;
    case 'result': onResult(m); break;
    case 'error':
      if (m.op === 'transcribe') { onResult({ ...m, text: '', error: m.text }); break; }
      fail(m.text);
      break;
  }
}
$('downloadBtn').onclick = load;

// ---------------------------------------------------------------- Aufnahme & Pausenerkennung
let recording = false, stream = null, ctx = null, proc = null, src = null, resampler = null;
let seg = [], segLen = 0, inSpeech = false, silentFor = 0, voicedFor = 0;
let preroll = [], prerollLen = 0, noise = 0.004;
const MIN_SILENCE = 0.7, MAX_SEG = 25, PREROLL = 0.35, LIVE_EVERY = 1.0;
let segNo = 0, lastLiveAt = 0, liveBusy = false;

function makeResampler(inRate) {
  const ratio = inRate / SR; let pos = 0;
  return (input) => {
    const out = new Float32Array(Math.floor((input.length - pos) / ratio) + 1);
    let n = 0;
    while (pos < input.length) {
      const i = Math.floor(pos), f = pos - i, a = input[i], b = i + 1 < input.length ? input[i + 1] : a;
      out[n++] = a + (b - a) * f; pos += ratio;
    }
    pos -= input.length;
    return out.subarray(0, n);
  };
}
function joinSeg() {
  const a = new Float32Array(segLen); let o = 0;
  for (const c of seg) { a.set(c, o); o += c.length; }
  return a;
}
function flush() {
  if (voicedFor >= 0.3 && segLen) {
    const id = nextId++;
    pending.set(id, null);
    const audio = joinSeg();
    worker.postMessage({ type: 'transcribe', id, live: false, audio, lang: 'de', terms: termPrompt }, [audio.buffer]);
  }
  seg = []; segLen = 0; inSpeech = false; silentFor = 0; voicedFor = 0; segNo++; lastLiveAt = 0;
}

function onAudio(e) {
  const chunk = resampler(e.inputBuffer.getChannelData(0));
  if (!chunk.length) return;
  let sum = 0; for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  const rms = Math.sqrt(sum / chunk.length), dur = chunk.length / SR;
  const voice = rms > Math.max(0.01, noise * 3.2);
  if (!inSpeech && !voice) noise = noise * 0.95 + rms * 0.05;
  $('meterBar').style.width = Math.min(100, rms * 600).toFixed(0) + '%';
  const copy = new Float32Array(chunk);
  if (!inSpeech) {
    preroll.push(copy); prerollLen += copy.length;
    while (prerollLen - preroll[0].length > PREROLL * SR) prerollLen -= preroll.shift().length;
    if (voice) { inSpeech = true; seg = preroll; segLen = prerollLen; preroll = []; prerollLen = 0; voicedFor = dur; silentFor = 0; }
    return;
  }
  seg.push(copy); segLen += copy.length;
  if (voice) { voicedFor += dur; silentFor = 0; } else silentFor += dur;
  if (silentFor >= MIN_SILENCE || segLen >= MAX_SEG * SR) { flush(); return; }
  // Live-Vorschau des gerade gesprochenen Satzes
  const secs = segLen / SR;
  if (!liveBusy && voicedFor >= 0.8 && secs - lastLiveAt >= LIVE_EVERY) {
    lastLiveAt = secs; liveBusy = true;
    const audio = joinSeg();
    worker.postMessage({ type: 'transcribe', id: -segNo - 1, live: true, audio, lang: 'de', terms: termPrompt }, [audio.buffer]);
  }
}

// Das Mikrofon bleibt geöffnet, solange die Seite offen ist (sonst fragt der Browser bei lokalen Dateien jedes Mal neu).
// Zwischen den Diktaten wird nichts ausgewertet; nach 15 Minuten ohne Diktat wird es freigegeben.
const MIC_IDLE_MS = 15 * 60 * 1000;
let idleTimer = null;
async function ensureMic() {
  if (stream && stream.getAudioTracks().some(t => t.readyState === 'live') && ctx && ctx.state !== 'closed') return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    setStatus('Kein Mikrofonzugriff', 'err');
    alert('Bitte den Mikrofonzugriff im Browser erlauben (Symbol in der Adressleiste).\n\n' + e.message);
    return false;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(2048, 1, 1);
  resampler = makeResampler(ctx.sampleRate);
  proc.onaudioprocess = (e) => { if (recording) onAudio(e); };
  src.connect(proc); proc.connect(ctx.destination);
  return true;
}
function releaseMic() {
  if (recording) return;
  try { proc.disconnect(); src.disconnect(); } catch (e) {}
  stream?.getTracks().forEach(t => t.stop());
  try { ctx?.close(); } catch (e) {}
  stream = ctx = proc = src = null;
}

async function start() {
  if (!ready || recording) return;
  clearTimeout(idleTimer);
  if (!(await ensureMic())) return;
  await ctx.resume();
  // Neues Diktat: vorheriges in den Verlauf, Textfeld leeren
  if ($('text').value.trim()) addHistory($('text').value.trim());
  $('text').value = ''; $('live').textContent = ''; $('clip').textContent = '';
  resampler = makeResampler(ctx.sampleRate);
  seg = []; segLen = 0; inSpeech = false; preroll = []; prerollLen = 0;
  recording = true;
  $('recBtn').classList.add('recording'); $('recBtn').textContent = '■';
  $('hint').textContent = 'Ich höre zu … Klicken zum Beenden.';
  setStatus('Aufnahme läuft', 'rec');
}

function stop() {
  if (!recording) return;
  recording = false;
  if (inSpeech) flush();
  ctx.suspend().catch(() => {});
  clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseMic, MIC_IDLE_MS);
  $('meterBar').style.width = '0%';
  $('recBtn').classList.remove('recording'); $('recBtn').textContent = '🎙️';
  $('hint').textContent = 'Klicken und sprechen. Nochmal klicken zum Beenden. Der Text wird dann automatisch kopiert.';
  finishIfDone();
}

$('recBtn').onclick = () => recording ? stop() : start();
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); if (!$('recBtn').disabled) $('recBtn').click(); }
});

// ---------------------------------------------------------------- Glossar
// Eigene Wörter: werden Whisper als Hinweis mitgegeben und ähnlich klingende Wörter automatisch korrigiert.
// Zeilen „falsch => richtig“ ersetzen immer.
let TERMS = [];   // { text, words:[...], norm, code }
let RULES = [];   // { re, to }
let termPrompt = '';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normWord = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function koeln(word) {
  // Kölner Phonetik: gleich klingende deutsche Wörter bekommen denselben Code
  const w = word.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 's').replace(/[^a-z]/g, '');
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i], p = w[i - 1] || '', n = w[i + 1] || '';
    let k = '';
    if ('aeijouy'.includes(c)) k = '0';
    else if (c === 'h') k = '';
    else if (c === 'b') k = '1';
    else if (c === 'p') k = n === 'h' ? '3' : '1';
    else if (c === 'd' || c === 't') k = 'csz'.includes(n) ? '8' : '2';
    else if ('fvw'.includes(c)) k = '3';
    else if ('gkq'.includes(c)) k = '4';
    else if (c === 'c') k = i === 0 ? ('ahkloqrux'.includes(n) ? '4' : '8') : ('sz'.includes(p) ? '8' : ('ahkoqux'.includes(n) ? '4' : '8'));
    else if (c === 'x') k = 'ckq'.includes(p) ? '8' : '48';
    else if (c === 'l') k = '5';
    else if (c === 'm' || c === 'n') k = '6';
    else if (c === 'r') k = '7';
    else if (c === 's' || c === 'z') k = '8';
    out += k;
  }
  let r = '';
  for (let i = 0; i < out.length; i++) if (out[i] !== out[i - 1]) r += out[i];
  return r[0] + r.slice(1).replace(/0/g, '');
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

function parseTerms() {
  TERMS = []; RULES = [];
  const seen = new Set();
  const addTerm = (t) => {
    t = t.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    const words = t.split(/\s+/);
    const norm = words.map(normWord).join(' ');
    TERMS.push({ text: t, words, norm, code: koeln(norm.replace(/ /g, '')) });
  };
  for (let line of termsText().split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.split(/\s*=>\s*/);
    if (m.length === 2 && m[1]) {
      for (const src of m[0].split(',').map(s => s.trim()).filter(Boolean)) {
        RULES.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(src)}(?![\\p{L}\\p{N}])`, 'giu'), to: m[1].trim() });
      }
      addTerm(m[1]);
    } else addTerm(line);
  }
  termPrompt = TERMS.length ? 'Fachbegriffe: ' + TERMS.map(t => t.text).join(', ') + '.' : '';
}

function applyTerms(text) {
  for (const r of RULES) text = text.replace(r.re, r.to);
  if (!TERMS.length) return text;
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu)].map(m => ({ w: m[0], s: m.index, e: m.index + m[0].length }));
  const repl = [];
  for (let i = 0; i < words.length; i++) {
    let best = null;
    for (const t of TERMS) {
      const n = t.words.length;
      if (i + n > words.length) continue;
      // nur zusammenhängende Wörter (keine Satzzeichen dazwischen)
      let ok = true;
      for (let j = i; j < i + n - 1; j++) if (!/^\s+$/.test(text.slice(words[j].e, words[j + 1].s))) { ok = false; break; }
      if (!ok) continue;
      const cand = words.slice(i, i + n).map(x => normWord(x.w)).join(' ');
      const original = text.slice(words[i].s, words[i + n - 1].e);
      if (original === t.text) { best = null; break; }
      let score = 0;
      if (cand === t.norm) score = 2;
      else if (t.norm.length >= 4) {
        const s = sim(cand, t.norm);
        if (s >= 0.8) score = s;
        else if (s >= 0.55 && koeln(cand.replace(/ /g, '')) === t.code) score = 0.75;
      }
      if (score && (!best || score > best.score)) best = { score, t, n };
    }
    if (best) {
      repl.push({ s: words[i].s, e: words[i + best.n - 1].e, to: best.t.text });
      i += best.n - 1;
    }
  }
  for (const r of repl.reverse()) text = text.slice(0, r.s) + r.to + text.slice(r.e);
  return text;
}


const termsText = () => $('terms').value;
$('terms').value = store.get('terms', '');
parseTerms();
$('terms').addEventListener('input', () => { store.set('terms', $('terms').value); parseTerms(); });
$('addFix').onclick = () => {
  const ta = $('text');
  let wrong = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  if (!wrong) wrong = (prompt('Welches Wort wird falsch erkannt? (so wie es im Text steht)') || '').trim();
  if (!wrong) return;
  const right = (prompt(`Wie soll „${wrong}“ richtig geschrieben werden?`, wrong) || '').trim();
  if (!right) return;
  const t = $('terms');
  t.value = (t.value.trim() ? t.value.replace(/\s*$/, '\n') : '') + (right === wrong ? right : `${wrong} => ${right}`);
  store.set('terms', t.value); parseTerms();
  $('glossDetails').open = true;
  ta.value = applyTerms(ta.value);   // gleich im aktuellen Text korrigieren
  copyNow();
};

// ---------------------------------------------------------------- Ergebnisse (in Reihenfolge, wortgetreu)
let nextId = 1, nextToInsert = 1;
const pending = new Map();

// Nur offensichtliche Whisper-Fehler bei Stille verwerfen – der eigentliche Text bleibt unverändert.
const JUNK = [
  /untertitel (im auftrag|der amara|von stephanie)/i, /amara\.org/i,
  /^\s*(vielen dank( fürs zuschauen)?|danke( schön)?|tschüss|bis zum nächsten mal)[.!]*\s*$/i,
  /^\s*[\[(]?(musik|music|applaus|stille|lacht)[\])]?\s*$/i, /^\s*[.…,!?\-–\s]*$/,
];
const usable = (t) => { t = (t || '').replace(/\s+/g, ' ').trim(); return JUNK.some(r => r.test(t)) ? '' : t; };

function onResult(r) {
  if (r.live) {
    liveBusy = false;
    if (r.id === -segNo - 1 && !r.error && recording) $('live').textContent = applyTerms(usable(r.text));
    return;
  }
  if (!pending.has(r.id)) return;
  pending.set(r.id, r);
  while (pending.has(nextToInsert) && pending.get(nextToInsert)) {
    const res = pending.get(nextToInsert);
    pending.delete(nextToInsert); nextToInsert++;
    const t = res.error ? '' : applyTerms(usable(res.text));
    if (t) {
      const ta = $('text');
      ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + t;
      ta.scrollTop = ta.scrollHeight;
      $('live').textContent = '';
      copyNow();           // nach jedem erkannten Satz aktualisieren
    }
  }
  finishIfDone();
}

function finishIfDone() {
  const busy = [...pending.values()].some(v => v === null);
  if (recording) return;
  if (busy) { setStatus('Erkenne letzten Satz …', 'warn'); return; }
  setStatus('Bereit', 'ok');
  $('live').textContent = '';
  if ($('text').value.trim()) copyNow();
}

// ---------------------------------------------------------------- Zwischenablage
let copyPending = false;
async function copyNow() {
  const t = $('text').value.trim();
  if (!t) return;
  try {
    if (!document.hasFocus()) throw new Error('kein Fokus');
    await navigator.clipboard.writeText(t);
    copyPending = false;
    $('clip').className = 'ok-t';
    $('clip').textContent = '✓ In der Zwischenablage – mit Strg + V einfügen';
  } catch (e) {
    // Browser erlauben das Kopieren nur, solange die Seite im Vordergrund ist
    copyPending = true;
    $('clip').className = 'warn-t';
    $('clip').textContent = 'Wird kopiert, sobald du dieses Fenster anklickst';
  }
}
window.addEventListener('focus', () => { if (copyPending) copyNow(); });
$('copyBtn').onclick = copyNow;
$('text').addEventListener('blur', () => { if ($('text').value.trim()) copyNow(); });

// ---------------------------------------------------------------- Verlauf
function loadHistory() { try { return JSON.parse(store.get('history', '[]')); } catch (e) { return []; } }
function addHistory(t) {
  const h = loadHistory(); h.unshift({ t, d: Date.now() });
  store.set('history', JSON.stringify(h.slice(0, 20)));
  renderHistory();
}
function renderHistory() {
  const ul = $('history'); ul.innerHTML = '';
  const h = loadHistory();
  if (!h.length) { ul.innerHTML = '<li class="small">Noch nichts diktiert.</li>'; return; }
  for (const { t, d } of h) {
    const li = document.createElement('li');
    const span = document.createElement('span'); span.textContent = t;
    const time = document.createElement('small'); time.className = 'small';
    time.textContent = new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const b = document.createElement('button'); b.textContent = '📋';
    b.title = 'Kopieren';
    b.onclick = async () => { try { await navigator.clipboard.writeText(t); b.textContent = '✓'; setTimeout(() => b.textContent = '📋', 1200); } catch (e) {} };
    li.append(span, time, b); ul.append(li);
  }
}

// ---------------------------------------------------------------- Start
async function boot() {
  renderHistory();
  try { navigator.storage?.persist?.(); } catch (e) {}
  model = await pickModel();
  showModel();
  startWorker();
  worker.postMessage({ type: 'status', models: [model.id] });
}

// Service Worker: offline + mehrere Prozessorkerne. Beim allerersten Besuch einmal neu laden.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!self.crossOriginIsolated && !sessionStorage.getItem('diktat-reloaded')) {
    setStatus('Installiere App (einmalig) …', 'warn');
    navigator.serviceWorker.ready.then(() => { sessionStorage.setItem('diktat-reloaded', '1'); location.reload(); });
  } else boot();
} else boot();
