# Übergabe: KursBaukasten – Design an Rise anpassen

Diese Notiz ist der Startpunkt für eine lokale Claude-Sitzung (Desktop-App oder Claude Code auf dem eigenen PC).

## Stand

- `kursbaukasten.html` ist ein fertiges, getestetes Autorentool für E-Learnings. Es ist eine einzige Datei und läuft ohne Installation im Browser (Edge oder Chrome).
- Bausteine:
  - Inhaltsblöcke: Text, Bild, Video, Akkordeon, Tabs, Karteikarten und weitere
  - Wissenschecks: Single Choice, Multiple Choice, Wahr/Falsch, Lückentext
  - Fortgeschritten: Drag & Drop Sortieren und Zuordnen, Hotspots, Zeitstrahl, Prozess-Schritte
- Abschlusstest mit Bestehensgrenze.
- Copilot-Workflow: Prompt erzeugen → JSON-Antwort importieren (Storyboard) und Übersetzung als eigene Sprachkopie.
- Export als SCORM 1.2 (ZIP), ein Paket je Sprache.
- Fester Stihl-Look in Orange, Dunkelgrau und Weiß; Logo, Titelbild und Hausschrift lassen sich hochladen.

## Offene Aufgabe

Das Design des Kurs-Players (der Teil, den die Lernenden sehen) soll an das Design der vorhandenen Articulate-Rise-Kurse angeglichen werden.

1. Den Nutzer bitten, sich selbst im Browser bei Rise anzumelden. Zugangsdaten nicht im Chat abfragen.
2. Einen typischen Kurs ansehen: Startseite, Lektion mit Navigation, Quiz, Akkordeon/Tabs, Karteikarten.
3. Erfassen:
   - Farben, Schriften und Schriftgrößen
   - Abstände und Inhaltsbreite
   - Gestaltung von Buttons, Navigation und Fortschrittsanzeige
   - Optik der Blöcke und des Quiz-Feedbacks
4. In `kursbaukasten.html` den Block `<script type="text/plain" id="player-css">` anpassen. Das ist das CSS des Players, das in Vorschau und SCORM-Export eingebettet wird. Die Klassennamen dort sind die Hooks (`.side`, `.nav`, `.lesson`, `.blk-*`, `.q`, `.opt`, `.btn` usw.).
5. Bei Bedarf die Farbvariablen im Editor-`<style>` oben (`:root{--acc:...}`) angleichen.
6. Prüfen: Datei im Browser öffnen, Beispielkurs in der Vorschau durchklicken (Desktop und Smartphone), SCORM-Export erzeugen und testen.

## Alternative ohne Login

Ein Rise-Kurs als Web- oder SCORM-Export (ZIP) enthält die CSS-Dateien des Themes. Daraus lassen sich Farben und Schriften exakt auslesen.
