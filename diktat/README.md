# Offline-Diktat (Whisper im Browser)

Ein Diktierprogramm in **einer einzigen HTML-Datei**. Die Spracherkennung (OpenAI Whisper über
[transformers.js](https://github.com/huggingface/transformers.js)) läuft komplett im Browser.
Es wird nichts installiert und nichts hochgeladen.

## Benutzung

1. `diktat.html` per Doppelklick in **Chrome oder Edge** öffnen.
2. Beim ersten Mal unter **„Einrichtung & Offline-Paket“** auf **„einmalig herunterladen“** klicken.
   Dafür braucht es einmal Internet. Die Dateien landen im Browserspeicher.
3. **„Diktat starten“** klicken (oder <kbd>Strg</kbd> + <kbd>Leertaste</kbd>), das Mikrofon erlauben und lossprechen.
   Nach jeder kurzen Pause wird der Abschnitt erkannt und an der Cursor-Position eingefügt.

Ab dann funktioniert alles **ohne Internet**.

## Modelle

| Modell | Download | Hinweis |
|---|---|---|
| Whisper Tiny  | ≈ 40 MB  | schnell, für Deutsch eher ungenau |
| Whisper Base  | ≈ 80 MB  | Standard |
| Whisper Small | ≈ 250 MB | deutlich genauer, braucht einen flotten PC |
| Parakeet v3 CPU | ≈ 700 MB | NVIDIA Parakeet TDT 0.6B v3: sehr genau, erkennt die Sprache selbst (25 europäische Sprachen), auf dem Prozessor langsamer |
| Parakeet v3 GPU | ≈ 2,5 GB | wie oben, aber über die Grafikkarte (WebGPU) schnell; experimentell |

Die Größen sind ungefähre Angaben. Dazu kommt einmalig die passende Laufzeit-Bibliothek (Whisper ≈ 22 MB, Parakeet ≈ 25 MB).
Parakeet läuft über [parakeet.js](https://github.com/ysdede/parakeet.js) (MIT-Lizenz, in `diktat.html` eingebettet)
mit dem Modell [`ysdede/parakeet-tdt-0.6b-v3-onnx`](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx) (CC-BY-4.0).

## Für Rechner ganz ohne Internet (USB-Stick)

1. Auf einem Rechner mit Internet die gewünschten Modelle herunterladen (siehe oben).
2. **„Offline-Paket speichern …“** klicken und einen Ordner wählen, z. B. `E:\Diktat` auf dem USB-Stick.
   Dort entsteht ein Unterordner `dateien`.
3. `diktat.html` in denselben Ordner kopieren.
4. Auf dem Zielrechner `diktat.html` öffnen, **„Offline-Paket-Ordner laden …“** klicken und den Ordner `Diktat` wählen.
   Danach liegen die Dateien auch dort im Browserspeicher.

```
Diktat/
├── diktat.html
└── dateien/
    ├── lib/        (Whisper-Laufzeit)
    ├── modelle/    (Sprachmodelle)
    └── manifest/
```

## Sprachbefehle

- „neue Zeile“ → Zeilenumbruch, „neuer Absatz“ → Leerzeile
- Optional: „Komma“, „Punkt“, „Fragezeichen“, „Ausrufezeichen“, „Doppelpunkt“

## Hinweise

- Whisper setzt Satzzeichen und Großschreibung selbst.
- Der Text wird automatisch im Browser zwischengespeichert. Mit „Als .txt speichern“ sicherst du ihn als Datei.
- Firefox kann einzelne Funktionen (Ordner speichern, Browserspeicher bei `file://`) nicht. Empfohlen sind Chrome oder Edge.
