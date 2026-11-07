// Diktat – Hauptprogramm (Oberfläche, Aufnahme, Live-Vorschau, Fachbegriffe, KI-Textverbesserung)
const $ = (id) => document.getElementById(id);
const SR = 16000;

// ---------------------------------------------------------------- Einstellungen
const store = {
  get(k, d) { try { const v = localStorage.getItem('diktat.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('diktat.' + k, v); } catch (e) {} },
};
const ASR_MODELS = [...$('modelSel').options].map(o => o.value);
const LLM_MODELS = [...$('llmSel').options].map(o => o.value);
for (const [id, key, def] of [['modelSel', 'model', 'Xenova/whisper-base'], ['langSel', 'lang', 'de'], ['llmSel', 'llm', LLM_MODELS[0]]]) {
  const v = store.get(key, def);
  if ([...$(id).options].some(o => o.value === v)) $(id).value = v;
}
$('punctCmds').checked = store.get('punct', '0') === '1';
$('liveChk').checked = store.get('live', '1') === '1';
$('text').value = store.get('text', '');
$('terms').value = store.get('terms', '');
$('text').addEventListener('input', () => store.set('text', $('text').value));
$('langSel').addEventListener('change', () => store.set('lang', $('langSel').value));
$('punctCmds').addEventListener('change', () => store.set('punct', $('punctCmds').checked ? '1' : '0'));
$('liveChk').addEventListener('change', () => { store.set('live', $('liveChk').checked ? '1' : '0'); renderLive(); });
$('terms').addEventListener('input', () => { store.set('terms', $('terms').value); parseTerms(); });

// ---------------------------------------------------------------- Status-Anzeige
function setStatus(text, kind) {
  $('statusText').textContent = text;
  $('statusDot').className = 'dot' + (kind ? ' ' + kind : '');
}
function setupMsg(text, cls) {
  $('setupMsg').textContent = text || '';
  $('setupMsg').className = 'small msg' + (cls ? ' ' + cls : '');
}
const fmtMB = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB';
const optLabel = (sel, v) => sel.querySelector(`option[value="${v}"]`).textContent.split(' – ')[0];

// ---------------------------------------------------------------- Fachbegriffe
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
  for (let line of $('terms').value.split(/\r?\n/)) {
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
parseTerms();

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

// ---------------------------------------------------------------- Textaufbereitung
const JUNK = [
  /untertitel (im auftrag|der amara|von stephanie)/i, /amara\.org/i,
  /^\s*(vielen dank( fürs zuschauen)?|danke( schön)?|tschüss|bis zum nächsten mal)[.!]*\s*$/i,
  /^\s*thanks? (you )?(for watching)?[.!]*\s*$/i, /^\s*[\[(]?(musik|music|applaus|stille|lacht)[\])]?\s*$/i,
  /^\s*[.…,!?\-–\s]*$/,
  /^\s*([\p{L}']+)[,.!?]?(\s+\1[,.!?]?){2,}\s*$/iu,   // „Du, du, du.“
];
function cleanup(t) {
  t = (t || '').replace(/\s+/g, ' ').trim();
  if (JUNK.some(rx => rx.test(t))) return '';
  t = t.replace(/[\s,.]*\bneuer absatz\b[.,!?]?\s*/gi, '\n\n')
       .replace(/[\s,.]*\b(neue|nächste) zeile\b[.,!?]?\s*/gi, '\n');
  if ($('punctCmds').checked) {
    const map = { komma: ',', punkt: '.', fragezeichen: '?', ausrufezeichen: '!', doppelpunkt: ':', semikolon: ';', bindestrich: '-' };
    t = t.replace(/[\s,.]*\b(komma|punkt|fragezeichen|ausrufezeichen|doppelpunkt|semikolon|bindestrich)\b[.,!?]?/gi, (_, w) => map[w.toLowerCase()]);
    t = t.replace(/([,.?!:;])(?=\S)/g, '$1 ').replace(/ ([,.?!:;])/g, '$1');
  }
  return applyTerms(t);
}

// ---------------------------------------------------------------- Text einfügen / Rückgängig
const history = [];
function snapshot() {
  history.push($('text').value);
  if (history.length > 50) history.shift();
  $('undoBtn').disabled = false;
}
$('undoBtn').onclick = () => {
  if (!history.length) return;
  $('text').value = history.pop();
  store.set('text', $('text').value);
  $('undoBtn').disabled = !history.length;
};

let caret = null;
$('text').addEventListener('click', () => { caret = $('text').selectionEnd; });
$('text').addEventListener('keyup', () => { caret = $('text').selectionEnd; });
function insertText(t) {
  if (!t) return;
  const ta = $('text');
  const pos = caret == null || caret > ta.value.length ? ta.value.length : caret;
  const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
  let ins = t;
  if (before && !/\s$/.test(before) && !/^[\s,.?!:;]/.test(ins)) ins = ' ' + ins;
  if (!before || /[.!?]\s*$|\n\s*$/.test(before)) ins = ins.replace(/^(\s*)(\p{Ll})/u, (_, s, c) => s + c.toUpperCase());
  if (after && !/^\s/.test(after) && !/\s$/.test(ins)) ins += ' ';
  ta.value = before + ins + after;
  caret = pos + ins.length;
  if (document.activeElement === ta) ta.setSelectionRange(caret, caret);
  if (caret >= ta.value.length - 1) ta.scrollTop = ta.scrollHeight;
  store.set('text', ta.value);
}

// ---------------------------------------------------------------- Spracherkennungs-Worker
const family = (m) => m.startsWith('parakeet:') ? 'parakeet' : 'whisper';
let asr = null, asrFamily = null, asrReady = null, asrLoading = false;
let gpuAvailable = false;
const fileProgress = new Map();

function createAsr(fam) {
  if (asr) asr.terminate();
  resetQueue();
  asrLoading = false; asrReady = null;
  asr = new Worker('asr-worker.js', { type: 'module' });
  asrFamily = fam;
  asr.onmessage = onAsrMessage;
  asr.onerror = (e) => { setStatus('Fehler im Hintergrundprozess', 'err'); setupMsg(e.message || 'Hintergrundprozess abgestürzt (zu wenig Arbeitsspeicher?)', 'err-t'); };
}

const llmManifestId = (m) => m + (gpuAvailable ? '' : ':cpu');
function requestStatus() { asr?.postMessage({ type: 'status', models: [...ASR_MODELS, ...LLM_MODELS.map(llmManifestId)] }); }

let lastStatus = { models: {} };
function renderStatus(s) {
  lastStatus = s;
  const m = $('modelSel').value, l = $('llmSel').value;
  const li = (name, ok, sel) => `<li><span>${name}${sel ? ' <b>(gewählt)</b>' : ''}</span><span class="${ok ? 'ok-t' : 'err-t'}">${ok ? '✓ offline verfügbar' : '✗ noch nicht geladen'}</span></li>`;
  $('fileList').innerHTML =
    ASR_MODELS.map(x => li('Spracherkennung ' + optLabel($('modelSel'), x), s.models[x], x === m)).join('') +
    LLM_MODELS.map(x => li('KI ' + optLabel($('llmSel'), x), s.models[llmManifestId(x)], x === l)).join('') +
    `<li><span>Rechenleistung</span><span>${self.crossOriginIsolated ? `${Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8))} Prozessorkerne` : '1 Prozessorkern (langsam – Seite neu laden)'}${gpuAvailable ? ' · Grafikkarte (WebGPU) ✓' : ' · keine WebGPU-Grafikkarte'}</span></li>` +
    (s.usage ? `<li><span>Belegter Browserspeicher</span><span>${fmtMB(s.usage)}</span></li>` : '');
  const ready = !!s.models[m];
  $('downloadBtn').textContent = ready ? `${optLabel($('modelSel'), m)} ist offline bereit ✓` : `${optLabel($('modelSel'), m)} laden (Internet nötig)`;
  $('downloadBtn').disabled = ready || asrLoading;
  const llmOk = !!s.models[llmManifestId(l)];
  $('llmDownloadBtn').textContent = llmOk ? `${optLabel($('llmSel'), l)} ist offline bereit ✓` : `${optLabel($('llmSel'), l)} laden (Internet nötig)`;
  $('llmDownloadBtn').disabled = llmOk || llmLoading;
  $('llmHint').textContent = gpuAvailable ? '' : 'Ohne WebGPU-Grafikkarte läuft die KI auf dem Prozessor und ist dann sehr langsam.';
  if (!ready) $('setupDetails').open = true;
  return ready;
}

function showProgress(p) {
  fileProgress.set(p.file, p);
  let loaded = 0, total = 0;
  for (const v of fileProgress.values()) { loaded += v.loaded; total += v.total || v.loaded; }
  $('progress').style.display = 'block';
  $('progress').firstElementChild.style.width = (total ? (100 * loaded / total) : 0).toFixed(1) + '%';
  setupMsg(`Lade ${p.file} … ${fmtMB(loaded)}${total ? ' von ' + fmtMB(total) : ''}`);
}

function loadAsr() {
  if (asrLoading) return;
  const m = $('modelSel').value;
  if (family(m) !== asrFamily) createAsr(family(m));
  asrLoading = true; asrReady = null;
  fileProgress.clear();
  $('recBtn').disabled = true; $('downloadBtn').disabled = true;
  setStatus('Lade Spracherkennung …', 'warn');
  asr.postMessage({ type: 'load', model: m });
}

function onAsrMessage(ev) {
  const msg = ev.data;
  switch (msg.type) {
    case 'status': {
      const ready = renderStatus(msg);
      if (!asrReady && !asrLoading) {
        if (ready) loadAsr();
        else { setStatus('Einrichtung nötig – bitte Spracherkennung laden', 'warn'); $('recBtn').disabled = true; }
      }
      break;
    }
    case 'phase': setStatus(msg.text, 'warn'); setupMsg(msg.text); break;
    case 'progress': showProgress(msg); break;
    case 'ready':
      asrLoading = false; asrReady = msg.model;
      $('progress').style.display = 'none'; setupMsg('');
      setStatus(recording ? 'Aufnahme läuft – sprich jetzt' : 'Bereit', recording ? 'rec' : 'ok');
      $('recBtn').disabled = false;
      requestStatus();
      break;
    case 'result': onResult(msg); break;
    case 'error':
      if (msg.op === 'transcribe') { onResult({ ...msg, text: '', error: msg.text }); break; }
      asrLoading = false;
      $('progress').style.display = 'none';
      setStatus('Fehler', 'err');
      setupMsg(msg.text, 'err-t');
      $('setupDetails').open = true;
      requestStatus();
      break;
  }
}

$('downloadBtn').onclick = loadAsr;
$('modelSel').addEventListener('change', () => {
  store.set('model', $('modelSel').value);
  if (recording) stopRecording();
  updateLangField();
  createAsr(family($('modelSel').value));
  $('recBtn').disabled = true;
  requestStatus();
});
function updateLangField() {
  const pk = family($('modelSel').value) === 'parakeet';
  $('langSel').disabled = pk;
  $('langField').title = pk ? 'Parakeet erkennt die Sprache automatisch (25 europäische Sprachen).' : '';
}

$('wipeBtn').onclick = async () => {
  if (!confirm('Alle heruntergeladenen Modelle aus dem Browserspeicher löschen? Sie müssen dann neu geladen werden.')) return;
  asr?.terminate(); asr = null; llm?.terminate(); llm = null; llmReady = null;
  await new Promise((res) => { const r = indexedDB.deleteDatabase('diktat-web'); r.onsuccess = r.onerror = r.onblocked = res; });
  setupMsg('Alle Modelle gelöscht.', 'ok-t');
  createAsr(family($('modelSel').value));
  requestStatus();
};

// ---------------------------------------------------------------- Aufnahme & Pausenerkennung
let recording = false, stream = null, ctx = null, proc = null, src = null, resampler = null;
let seg = [], segLen = 0, inSpeech = false, silentFor = 0, voicedFor = 0;
let preroll = [], prerollLen = 0, noise = 0.004;
const MIN_SILENCE = 0.7, MAX_SEG = 25, PREROLL = 0.35, LIVE_EVERY = 0.8;
let segNo = 0, lastLiveAt = 0, liveInFlight = false, liveSentAt = 0;
let interim = '';
const pendingPreview = new Map();   // finale Abschnitte in Arbeit: id -> letzter Live-Text

function makeResampler(inRate) {
  const ratio = inRate / SR; let pos = 0;
  return (input) => {
    const out = new Float32Array(Math.floor((input.length - pos) / ratio) + 1);
    let n = 0;
    while (pos < input.length) {
      const i = Math.floor(pos), f = pos - i, a = input[i], b = i + 1 < input.length ? input[i + 1] : a;
      out[n++] = a + (b - a) * f;
      pos += ratio;
    }
    pos -= input.length;
    return out.subarray(0, n);
  };
}
function joinSeg() {
  const audio = new Float32Array(segLen);
  let o = 0; for (const c of seg) { audio.set(c, o); o += c.length; }
  return audio;
}
function flushSegment() {
  if (voicedFor >= 0.3 && segLen > 0) {
    const id = nextId++;
    pendingPreview.set(id, interim);
    enqueueFinal(id, joinSeg());
  }
  seg = []; segLen = 0; inSpeech = false; silentFor = 0; voicedFor = 0;
  segNo++; interim = ''; lastLiveAt = 0;
  renderLive();
}

function onAudio(e) {
  const chunk = resampler(e.inputBuffer.getChannelData(0));
  if (!chunk.length) return;
  let sum = 0; for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  const rms = Math.sqrt(sum / chunk.length);
  const dur = chunk.length / SR;
  const voice = rms > Math.max(0.01, noise * 3.2);
  if (!inSpeech && !voice) noise = noise * 0.95 + rms * 0.05;
  const bar = $('meterBar');
  bar.style.width = Math.min(100, rms * 600).toFixed(0) + '%';
  bar.className = voice ? 'voice' : '';

  const copy = new Float32Array(chunk);
  if (!inSpeech) {
    preroll.push(copy); prerollLen += copy.length;
    while (prerollLen - preroll[0].length > PREROLL * SR) prerollLen -= preroll.shift().length;
    if (voice) {
      inSpeech = true; seg = preroll; segLen = prerollLen; preroll = []; prerollLen = 0;
      voicedFor = dur; silentFor = 0;
      renderLive();
    }
    return;
  }
  seg.push(copy); segLen += copy.length;
  if (voice) { voicedFor += dur; silentFor = 0; } else silentFor += dur;
  if (silentFor >= MIN_SILENCE || segLen >= MAX_SEG * SR) { flushSegment(); return; }

  // Live-Vorschau: regelmäßig den bisherigen Abschnitt erkennen lassen
  const secs = segLen / SR;
  if ($('liveChk').checked && asrReady && !liveInFlight && voicedFor >= 0.8 && secs - lastLiveAt >= LIVE_EVERY) {
    lastLiveAt = secs; liveInFlight = true; liveSentAt = performance.now();
    const audio = joinSeg();
    asr.postMessage({ type: 'transcribe', id: -segNo - 1, live: true, audio, lang: $('langSel').value, terms: termPrompt }, [audio.buffer]);
  }
}

async function startRecording() {
  if (!asrReady) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    setStatus('Kein Mikrofonzugriff', 'err');
    alert('Auf das Mikrofon konnte nicht zugegriffen werden.\nBitte den Zugriff im Browser erlauben (Symbol in der Adressleiste).\n\n' + e.message);
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(2048, 1, 1);
  resampler = makeResampler(ctx.sampleRate);
  proc.onaudioprocess = onAudio;
  src.connect(proc); proc.connect(ctx.destination);
  seg = []; segLen = 0; inSpeech = false; preroll = []; prerollLen = 0; interim = '';
  recording = true;
  $('recBtn').classList.add('recording');
  $('recLabel').textContent = 'Diktat stoppen'; $('recIcon').textContent = '■';
  setStatus('Aufnahme läuft – sprich jetzt', 'rec');
  const ta = $('text');
  caret = (document.activeElement === ta || ta.selectionEnd !== ta.value.length) ? ta.selectionEnd : ta.value.length;
  snapshot();
  renderLive();
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  if (inSpeech) flushSegment();
  try { proc.disconnect(); src.disconnect(); } catch (e) {}
  stream.getTracks().forEach(t => t.stop());
  ctx.close();
  $('meterBar').style.width = '0%';
  $('recBtn').classList.remove('recording');
  $('recLabel').textContent = 'Diktat starten'; $('recIcon').textContent = '●';
  updateQueue();
  renderLive();
}

$('recBtn').onclick = () => recording ? stopRecording() : startRecording();
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); if (!$('recBtn').disabled) $('recBtn').click(); }
});

// ---------------------------------------------------------------- Live-Anzeige
const escHtml = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function renderLive() {
  const el = $('live');
  const pend = [...pendingPreview.values()].filter(Boolean).join(' ');
  const parts = [];
  if (pend) parts.push(`<span class="pend">${escHtml(pend)}</span>`);
  if (interim) parts.push(`<span class="interim">${escHtml(interim)}</span>`);
  if (recording && inSpeech) parts.push('<span class="cursor"></span>');
  if (parts.length) el.innerHTML = parts.join(' ');
  else if (recording) el.innerHTML = '<span class="placeholder">Ich höre zu …</span>';
  else el.innerHTML = `<span class="placeholder">${$('liveChk').checked ? 'Live-Vorschau: Hier erscheint der Text, während du sprichst.' : 'Live-Vorschau ist ausgeschaltet.'}</span>`;
}

// ---------------------------------------------------------------- Warteschlange & Ergebnisse
let nextId = 1, nextToInsert = 1;
const pending = new Map();   // id -> Ergebnis oder null
function resetQueue() {
  pending.clear(); pendingPreview.clear(); nextToInsert = nextId; liveInFlight = false; interim = '';
  if (typeof renderLive === 'function') renderLive();
}
function enqueueFinal(id, audio) {
  pending.set(id, null);
  asr.postMessage({ type: 'transcribe', id, live: false, audio, lang: $('langSel').value, terms: termPrompt }, [audio.buffer]);
  updateQueue();
}
function updateQueue() {
  const n = [...pending.values()].filter(v => v === null).length;
  if (recording) setStatus('Aufnahme läuft – sprich jetzt', 'rec');
  else if (n) setStatus(`Erkenne restlichen Text … (${n})`, 'warn');
  else if (asrReady) setStatus('Bereit', 'ok');
}
function onResult(r) {
  if (r.live) {
    liveInFlight = false;
    if (r.id === -segNo - 1 && !r.error) {
      const t = cleanup(r.text);
      if (t) interim = t;
      renderLive();
    }
    showPerf(r, true);
    return;
  }
  if (!pending.has(r.id)) return;
  pending.set(r.id, r);
  while (pending.has(nextToInsert) && pending.get(nextToInsert)) {
    const res = pending.get(nextToInsert);
    pending.delete(nextToInsert); pendingPreview.delete(nextToInsert); nextToInsert++;
    if (res.error) { $('perf').textContent = '⚠️ ' + res.error; continue; }
    insertText(cleanup(res.text));
    showPerf(res, false);
  }
  renderLive();
  updateQueue();
}
function showPerf(r, live) {
  if (!r.ms || !r.seconds) return;
  const f = r.ms / 1000 / r.seconds;
  $('perf').textContent = `${live ? 'Vorschau' : 'Erkennung'}: ${(r.ms / 1000).toFixed(1)} s für ${r.seconds.toFixed(1)} s Sprache` +
    (f > 0.8 ? ' – das Modell ist für diesen Rechner eher zu groß, ein kleineres macht die Live-Vorschau flüssiger.' : '');
}

// ---------------------------------------------------------------- Text-Aktionen
async function copyText(t, btn) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  const old = btn.textContent; btn.textContent = '✓ Kopiert'; setTimeout(() => btn.textContent = old, 1500);
}
$('copyBtn').onclick = () => copyText($('text').value, $('copyBtn'));
$('saveBtn').onclick = () => {
  const blob = new Blob([$('text').value.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'), d = new Date();
  a.download = `Diktat_${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}.txt`;
  a.href = URL.createObjectURL(blob); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('clearBtn').onclick = () => {
  if (!$('text').value) return;
  snapshot();
  $('text').value = ''; caret = 0; store.set('text', '');
};

// ---------------------------------------------------------------- KI-Textverbesserung
const MODES = {
  glaetten: 'Du bist ein sorgfältiger Lektor. Überarbeite den diktierten Text: Korrigiere Rechtschreibung, Grammatik und Zeichensetzung, entferne Füllwörter (z. B. äh, ähm, also, halt, sozusagen), Versprecher und unnötige Wiederholungen und glätte den Satzbau. Verändere weder Inhalt noch Bedeutung, füge nichts hinzu, behalte Sprache, Ich-Form und Absätze bei.',
  umformulieren: 'Formuliere den diktierten Text klar, präzise und gut lesbar um. Verbessere Struktur und Ausdruck, behalte aber alle Informationen und die Bedeutung bei. Erfinde nichts dazu. Behalte die Sprache des Textes bei.',
  prompt: 'Der diktierte Text ist eine Anfrage an einen KI-Assistenten. Formuliere daraus einen klaren, gut strukturierten Prompt mit Ziel, relevantem Kontext, konkreter Aufgabe und gewünschtem Antwortformat. Übernimm alle Details, erfinde nichts dazu, schreibe in der Sprache des Textes. Beantworte die Anfrage NICHT selbst, sondern gib nur den Prompt aus.',
  email: 'Formuliere aus dem diktierten Text eine höfliche, gut strukturierte E-Mail mit Anrede, Text und Grußformel. Übernimm alle Informationen und erfinde keine Fakten dazu. Wenn kein Empfängername genannt ist, verwende eine neutrale Anrede. Schreibe in der Sprache des Textes.',
};
let llm = null, llmReady = null, llmLoading = false, llmBusy = false;
let aiRange = null, aiRunId = 0, aiResult = '', queuedRun = null;

function ensureLlm() {
  if (!llm) {
    llm = new Worker('llm-worker.js', { type: 'module' });
    llm.onmessage = onLlmMessage;
    llm.onerror = (e) => aiError(e.message || 'KI-Hintergrundprozess abgestürzt (zu wenig Arbeitsspeicher?)');
  }
}
function loadLlm() {
  ensureLlm();
  if (llmLoading) return;
  const m = $('llmSel').value;
  if (llmReady === m) return;
  llmLoading = true; llmReady = null;
  fileProgress.clear();
  $('llmDownloadBtn').disabled = true;
  showAi('Lade KI-Modell …', true);
  llm.postMessage({ type: 'load', model: m });
}
function aiError(text) {
  if (/Could not locate file|Failed to fetch|NetworkError/i.test(text)) {
    text = 'Das KI-Modell konnte nicht geladen werden. Beim ersten Mal ist eine Internetverbindung nötig.\n(' + text + ')';
  }
  llmLoading = false; llmBusy = false; queuedRun = null;
  $('aiOut').classList.remove('busy');
  showAi('⚠️ ' + text, false);
  $('aiApply').disabled = true;
  $('progress').style.display = 'none';
  setupMsg(text, 'err-t');
  requestStatus();
}
function showAi(text, busy) {
  $('aiOut').style.display = 'block';
  $('aiOut').textContent = text;
  $('aiOut').classList.toggle('busy', !!busy);
  $('aiActions').style.display = 'flex';
  $('aiStop').style.display = busy ? '' : 'none';
  $('aiApply').style.display = $('aiCopy').style.display = busy ? 'none' : '';
}
function onLlmMessage(ev) {
  const msg = ev.data;
  switch (msg.type) {
    case 'phase': $('aiInfo').textContent = msg.text; break;
    case 'progress': showProgress(msg); $('aiInfo').textContent = $('setupMsg').textContent; break;
    case 'ready':
      llmLoading = false; llmReady = msg.model;
      $('progress').style.display = 'none'; setupMsg('');
      $('aiInfo').textContent = msg.device === 'webgpu' ? 'KI läuft auf der Grafikkarte' : 'KI läuft auf dem Prozessor (langsam)';
      requestStatus();
      if (queuedRun) { const q = queuedRun; queuedRun = null; runAi(q.system, q.text); }
      else showAi('KI-Modell ist bereit.', false);
      break;
    case 'token':
      if (msg.id === aiRunId) $('aiOut').textContent = msg.text;
      break;
    case 'done':
      if (msg.id !== aiRunId) break;
      llmBusy = false;
      aiResult = stripWrapper(msg.text);
      showAi(aiResult || '(keine Ausgabe)', false);
      $('aiApply').disabled = !aiResult;
      $('aiInfo').textContent = `fertig in ${(msg.ms / 1000).toFixed(1)} s`;
      break;
    case 'error': aiError(msg.text); break;
  }
}
const stripWrapper = (t) => t.replace(/^\s*("""|```[a-z]*)\s*/i, '').replace(/\s*("""|```)\s*$/, '').trim();

function startAi(instruction) {
  const ta = $('text');
  let s = ta.selectionStart, e = ta.selectionEnd;
  if (s === e) { s = 0; e = ta.value.length; }
  const text = ta.value.slice(s, e).trim();
  if (!text) { showAi('Es gibt noch keinen Text zum Verbessern.', false); $('aiApply').style.display = 'none'; return; }
  aiRange = { s, e, original: ta.value };
  const termsLine = TERMS.length ? `\nSchreibe diese Fachbegriffe exakt so: ${TERMS.map(t => t.text).join(', ')}.` : '';
  const system = instruction + termsLine + '\nAntworte ausschließlich mit dem fertigen Text – ohne Einleitung, ohne Anführungszeichen, ohne Kommentar.';
  const user = `Text:\n"""\n${text}\n"""`;
  if (llmReady !== $('llmSel').value) { queuedRun = { system, text: user }; loadLlm(); return; }
  runAi(system, user);
}
function runAi(system, text) {
  if (llmBusy) return;
  llmBusy = true; aiResult = '';
  aiRunId++;
  showAi('', true);
  $('aiInfo').textContent = 'KI schreibt …';
  llm.postMessage({ type: 'run', id: aiRunId, system, text });
}
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => startAi(MODES[b.dataset.mode]));
$('customBtn').onclick = () => {
  const ins = $('customInstr').value.trim();
  if (!ins) { $('customInstr').focus(); return; }
  startAi(`Bearbeite den diktierten Text nach dieser Anweisung: ${ins}\nErfinde keine Fakten dazu und schreibe in der Sprache des Textes.`);
};
$('customInstr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('customBtn').click(); });
$('aiStop').onclick = () => { llm?.postMessage({ type: 'stop' }); };
$('aiDiscard').onclick = () => { $('aiOut').style.display = 'none'; $('aiActions').style.display = 'none'; aiResult = ''; };
$('aiCopy').onclick = () => copyText(aiResult || $('aiOut').textContent, $('aiCopy'));
$('aiApply').onclick = () => {
  if (!aiResult || !aiRange) return;
  const ta = $('text');
  if (ta.value !== aiRange.original) {
    if (!confirm('Der Text wurde inzwischen geändert. Trotzdem ersetzen?')) return;
  }
  snapshot();
  const v = aiRange.original;
  const s = Math.min(aiRange.s, ta.value.length), e = Math.min(aiRange.e, ta.value.length);
  ta.value = (ta.value === v ? v : ta.value).slice(0, s) + aiResult + (ta.value === v ? v : ta.value).slice(e);
  store.set('text', ta.value);
  caret = s + aiResult.length;
  $('aiDiscard').click();
};
$('llmSel').addEventListener('change', () => { store.set('llm', $('llmSel').value); renderStatus(lastStatus); });
$('llmDownloadBtn').onclick = loadLlm;

// ---------------------------------------------------------------- Start
async function start() {
  try { gpuAvailable = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) {}
  try { navigator.storage?.persist?.(); } catch (e) {}
  updateLangField();
  renderLive();
  createAsr(family($('modelSel').value));
  requestStatus();
}

// Service Worker: offline + Mehrkern-Freigabe (crossOriginIsolated). Beim ersten Besuch einmal neu laden.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!self.crossOriginIsolated && !sessionStorage.getItem('diktat-reloaded')) {
    setStatus('Installiere App-Dateien (einmalig, ≈ 50 MB) …', 'warn');
    navigator.serviceWorker.ready.then(() => {
      sessionStorage.setItem('diktat-reloaded', '1');
      location.reload();
    });
  } else start();
} else start();
