# Motion-Graphics-Editor – Erweiterung der Engine

Datei: `motion-graphics-editor.html` (eine Datei, keine externen Bibliotheken).
Test: `test-neue-features.json` über **Copilot → JSON einfügen → Projekt ersetzen** laden.

Der Renderer zeichnet auf ein Canvas (kein DOM pro Element). Die neuen Felder sind deshalb dort umgesetzt;
Vorschau und Export laufen über dieselbe Zeichenfunktion und rechnen alles aus der Szenen-Zeit.

## Neue JSON-Felder

### Element

| Feld | Typ | Standard | Wirkung |
|---|---|---|---|
| `type: "svg"` | String | – | Neuer Elementtyp. Box `x, y, w, h` in %, Inhalt aus `markup`. Alle Felder `anim, ease, start, dur, exit, opacity` wirken wie bei `shape`. |
| `markup` | String | `""` | Vollständiges `<svg …>…</svg>`. Wird in die Box eingepasst (mittig, Seitenverhältnis bleibt; eigenes `preserveAspectRatio` im markup wird respektiert). Farb-Variablen (`{accent}` …) und Schrift-Variablen (`{head}` …) werden ersetzt. `<script>`, `foreignObject`, `on*`-Attribute und fremde Verweise werden entfernt; IDs werden pro Element eindeutig gemacht, `url(#…)`/`href="#…"` angepasst. |
| `fit` (bei `image`) | `"contain"` \| `"cover"` | `"contain"` | Bild vollständig zeigen oder Box füllen. `src` = URL oder Data-URL (PNG/JPG/SVG). |
| `loop` | `none` \| `pulse` \| `blink` \| `spin` \| `marquee` \| `float` | `"none"` | Endlos-Animation ab Ende der Einblendung (`start + dur`) bis Szenenende. Für alle Elementtypen. |
| `loopDur` | Zahl (s) | `1.5` | Dauer eines Durchlaufs. Bei `marquee`: Zeit für eine Inhaltslänge; negativ = Laufrichtung nach rechts. |
| `loopAmount` | Zahl | je Typ | `pulse`: Vergrößerung (0.06) · `blink`: kleinste Deckkraft (0.15) · `spin`: Grad je Durchlauf (360, negativ = links herum) · `marquee`: Lücke zwischen den Kopien in % der Bühnenbreite (Text: eine Schrifthöhe, sonst 0) · `float`: Weg in % der Bühnenbreite (6). |
| `path` | Array `{t, x, y, scale?, rotate?, opacity?}` | – | Bewegung über Wegpunkte. `t` = Szenen-Zeit in s, `x/y` in % (linke obere Ecke). Dazwischen ease-in-out, gleiche Punkte = Pause, nach dem letzten Punkt bleibt das Element stehen. Fehlende Werte übernehmen den vorigen Punkt. Für alle Elementtypen. |
| `z` | Zahl | `0` | Ebene: höher = weiter vorn. Bei gleichem Wert gilt die Reihenfolge im Array. |
| `group` (bei `text`) | String | `""` | Alle Texte mit gleicher `group` in einer Szene bekommen die kleinste ermittelte Schriftgröße. |

`marquee` auf einem Text ergibt einen einzeiligen, nahtlosen Lauftext, abgeschnitten auf die Breite `w`.
Auf `shape`/`svg`/`image` läuft der Box-Inhalt nahtlos durch die eigene Box (Laufband).

### Szene und Projekt

| Feld | Ort | Typ | Standard | Wirkung |
|---|---|---|---|---|
| `subsY` | Projekt | Zahl (%) | nicht gesetzt | Abstand der Untertitel vom unteren Rand. Nicht gesetzt = bisherige Position (8 % quer, 24 % hochkant). |
| `subsY` | Szene | Zahl (%) | nicht gesetzt | Überschreibt den Projektwert für diese Szene. |

## Geänderte und neue Funktionen

Neu: `optNum`, `normPath`, `loopFx`, `pathAt`, `svgTokens`, `svgParse`, `svgPrep`, `svgSource`, `svgFrame`, `svgImage`,
`layoutOwn`, `paintBox`.

Geändert: `normEl`, `normScene`, `normProject`, `setFormat`, `getImg`, `layoutText`, `drawEl`, `drawSubs`, `drawGuides`,
`drawScene`, `drawFrame`, `preloadImgs`, `renderRight`, `F`, `typeIc`, `jsonImport`, `buildPrompt`,
Eingabe-, Zieh- und Pfeiltasten-Handler, Start (`document.fonts.ready`).

## Hinweise

- **CSS-Animationen im markup** (`@keyframes`) starten mit dem Element (`start`) und werden pro Bild auf die
  Szenen-Zeit gestellt (30 Schritte/s). SMIL (`<animate>`) wird nicht zeitlich gesteuert.
- **Schrift im markup**: nur Systemschriften und die im Projekt gespeicherten Schriftdateien.
- **Bilder per URL** brauchen CORS-Freigabe des Servers, sonst sperrt der Browser den Videoexport. Data-URLs gehen immer.
- **Hilfslinien** (Raster, sicherer Bereich, Rahmen): Schalter in der Transportleiste oder Taste G; nur in der Vorschau.
- **`shrink`** misst bei jedem Bild neu; nach dem Laden der Webfonts wird zusätzlich neu gezeichnet.
- `path` wird in der JSON gepflegt; in der Oberfläche verschiebt Ziehen den ganzen Weg.
