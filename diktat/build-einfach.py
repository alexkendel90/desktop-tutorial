#!/usr/bin/env python3
"""Baut diktat-einfach.html (eine einzelne Datei, läuft per Doppelklick ohne Webadresse)
aus der Web-Version: web/index.html + web/einfach.js + einzeldatei/worker.js.

Aufruf:  python3 diktat/build-einfach.py
"""
from pathlib import Path

D = Path(__file__).resolve().parent
html = (D / 'web/index.html').read_text(encoding='utf-8')
js = (D / 'web/einfach.js').read_text(encoding='utf-8')
worker = (D / 'einzeldatei/worker.js').read_text(encoding='utf-8')


def rep(s, a, b):
    assert a in s, f'Textstelle nicht gefunden: {a[:70]!r}'
    return s.replace(a, b, 1)


# ---------- HTML: keine externen Dateien, Modellauswahl statt Link zur Web-Version
html = rep(html, '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg" type="image/svg+xml">\n', '')
html = rep(html, '<h1><img src="icon.svg" alt="">Diktat</h1>', '<h1>🎙️ Diktat</h1>')
html = rep(html, '''  <footer class="small">
    <kbd>Strg</kbd> + <kbd>Leertaste</kbd> startet und stoppt · Läuft komplett offline in diesem Browser ·
    <a href="voll.html">Version mit KI &amp; Fachbegriffen</a>
  </footer>''', '''  <footer class="small">
    <kbd>Strg</kbd> + <kbd>Leertaste</kbd> startet und stoppt · Läuft komplett offline in diesem Browser (Chrome oder Edge empfohlen)
    <details style="margin-top:10px">
      <summary>Modell</summary>
      <p><select id="modelSel">
        <option value="auto">Automatisch (empfohlen)</option>
        <option value="turbo">Whisper Large v3 Turbo – am genauesten, braucht Grafikkarte (≈ 1,3 GB)</option>
        <option value="small">Whisper Small – genau, auf dem Prozessor langsam (≈ 250 MB)</option>
        <option value="base">Whisper Base – schnell, etwas ungenauer (≈ 80 MB)</option>
      </select></p>
    </details>
  </footer>''')
html = rep(html, '  #history { list-style', '  select { font: inherit; background: var(--field); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; max-width: 100%; }\n  #history { list-style')

# ---------- Skript: Worker als Blob (lokale Dateien erlauben keine Modul-Worker), Base als Prozessor-Modell
js = rep(js, """  small: {
    id: 'Xenova/whisper-small', name: 'Whisper Small', where: 'Prozessor', size: '≈ 250 MB',
    opts: { device: 'wasm', dtype: 'q8' },
  },
};""", """  small: {
    id: 'Xenova/whisper-small', name: 'Whisper Small', where: 'Prozessor', size: '≈ 250 MB',
    opts: { device: 'wasm', dtype: 'q8' },
  },
  base: {
    id: 'Xenova/whisper-base', name: 'Whisper Base', where: 'Prozessor', size: '≈ 80 MB',
    opts: { device: 'wasm', dtype: 'q8' },
  },
};""")
js = rep(js, "// mit Grafikkarte (WebGPU + fp16) Whisper Large v3 Turbo, sonst Whisper Small auf dem Prozessor.",
         "// mit Grafikkarte (WebGPU + fp16) Whisper Large v3 Turbo, sonst Whisper Base auf dem Prozessor\n"
         "// (als lokale Datei darf der Browser nur einen Prozessorkern nutzen – Small wäre dort zu langsam).")
js = rep(js, "  return MODELS.small;\n}", "  return MODELS.base;\n}")
js = rep(js, "  worker = new Worker('asr-worker.js', { type: 'module' });",
         "  worker = new Worker(URL.createObjectURL(new Blob([document.getElementById('workerCode').textContent], { type: 'text/javascript' })));")
js = rep(js, """    store.set('model', 'small');
    model = MODELS.small;
    $('msg').textContent = 'Das Grafikkarten-Modell lief hier nicht, ich nehme Whisper Small.';""", """    store.set('model', 'base');
    model = MODELS.base;
    $('msg').textContent = 'Das Grafikkarten-Modell lief hier nicht, ich nehme Whisper Base.';""")
js = rep(js, """    if (!document.hasFocus()) throw new Error('kein Fokus');
    await navigator.clipboard.writeText(t);""", """    if (!document.hasFocus()) throw new Error('kein Fokus');
    try { await navigator.clipboard.writeText(t); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
      if (!ok) throw e;
    }""")
js = rep(js, "  renderHistory();\n  try { navigator.storage?.persist?.(); } catch (e) {}",
         "  renderHistory();\n  try { navigator.storage?.persist?.(); } catch (e) {}\n  $('setup').style.display = 'none';")
i = js.index("// Service Worker: offline")
js = js[:i] + """$('modelSel').value = store.get('model', 'auto') || 'auto';
$('modelSel').addEventListener('change', () => {
  store.set('model', $('modelSel').value === 'auto' ? '' : $('modelSel').value);
  if (recording) stop();
  ready = false; loading = false; $('recBtn').disabled = true;
  boot();
});
boot();
"""
js = '(() => {\n' + js + '\n})();'

assert '</script' not in worker and '</script' not in js
html = rep(html, '<script type="module" src="einfach.js"></script>',
           '<script type="text/plain" id="workerCode">\n' + worker + '</script>\n<script>\n' + js + '\n</script>')
(D / 'diktat-einfach.html').write_text(html, encoding='utf-8')
print('geschrieben:', D / 'diktat-einfach.html', len(html), 'Zeichen')
