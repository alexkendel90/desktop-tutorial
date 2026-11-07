# Diktat (Web-App)

Diktieren mit **Live-Vorschau**, **eigenen Fachbegriffen** und **KI-Textverbesserung**. Alles läuft im Browser,
Sprache und Text verlassen das Gerät nicht. Nach dem ersten Laden funktioniert die App auch **offline**.

Unterschiede zur Einzeldatei-Version (`../diktat.html`):

- **Schneller:** Über eine Webadresse darf der Browser mehrere Prozessorkerne nutzen. Als lokale Datei bekommt die Seite nur einen.
- **Live-Vorschau:** Während du sprichst, erscheint der Text grau. Nach einer kurzen Pause wird er endgültig eingefügt.
- **Fachbegriffe:** Die Liste wird Whisper als Hinweis mitgegeben. Ähnlich klingende Wörter werden automatisch korrigiert
  (Kölner Phonetik und Ähnlichkeitsvergleich). Feste Regeln schreibst du als `falsch => richtig`.
- **KI-Textverbesserung:** Glätten, Umformulieren, Als KI-Prompt, Als E-Mail oder eine eigene Anweisung.
  Das macht ein lokales Sprachmodell (Qwen 2.5, 0,5B oder 1,5B), am besten mit WebGPU-Grafikkarte.

## Veröffentlichen

Den Ordner `diktat/web` unverändert als statische Website hochladen, z. B.:

- **Netlify:** Ordner per Drag & Drop auf <https://app.netlify.com/drop> ziehen. Die Datei `_headers` sorgt für den Mehrkern-Modus.
- **GitHub Pages** oder ein anderer Webspace: funktioniert ebenfalls. Fehlen die Header, setzt sie der Service Worker (`sw.js`).
  Die Seite lädt dann beim ersten Besuch einmal neu.

Wichtig: Die Seite muss über `https://` (oder `http://localhost`) laufen.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `app.js` | Oberfläche, Aufnahme, Pausenerkennung, Live-Vorschau, Fachbegriffe, KI-Steuerung |
| `asr-worker.js` | Spracherkennung (Whisper über transformers.js oder Parakeet v3 über parakeet.js) |
| `llm-worker.js` | KI-Textverbesserung (transformers.js, Text-Generierung) |
| `store.js` | Modell-Speicher in IndexedDB, Downloads mit Fortschritt |
| `sw.js` | Offline-Cache und COOP/COEP-Header (Mehrkern-Modus) |
| `lib/` | transformers.js 3.8.1, onnxruntime-web 1.24.1, parakeet.js 1.4.4 (gebündelt). Lizenzen liegen jeweils dabei |

## Getestet / nicht getestet

- Getestet (Chromium, lokal): Whisper Tiny mit Live-Vorschau, Fachbegriff-Korrektur, Mehrkern-Modus über den Service Worker,
  Neustart ohne Internet. Bei Parakeet und KI lädt die Programmbibliothek, danach stoppt der Test mit einer
  verständlichen Meldung, weil das Modell fehlt.
- **Nicht getestet:** die echten Parakeet- und Qwen-Modelle. Hugging Face war in der Testumgebung gesperrt.
