# Sun Path

A phone web app (PWA) that overlays the sun's path on the camera image, to check whether a room
gets direct sunlight during a chosen period or season.

It does not show where the sun is right now. It shows the **band of sky the sun crosses** between
the highest and the lowest path of the selected period:

- **Orange arc**: highest sun path of the period (21 Jun for a full year in the northern hemisphere).
- **Blue arc**: lowest path (21 Dec for a full year).
- **Shaded band**: everywhere the sun can be during the period. If the band crosses open sky,
  the room gets sun. If a building or the window frame covers it, that part is in shade.
- **Dashed thin arcs**: the path on the 21st of each month inside the period.
- **Hour lines** (`9h`, `12h`, …): where the sun is at that clock time across the period.
  In clock-time mode, the lines split at the DST change.
- **Horizon line** with compass directions.

## Using it on the phone

1. Open the GitHub Pages URL in Chrome on the phone, then tap **Start camera**.
   Allow the camera, location and motion sensors when asked.
2. Pick a period with the top button (full year, seasons, heating season, or custom dates).
3. **Calibrate the compass** (indoors it can be off by 10–20°). On a sunny day, tap **Calibrate**,
   put the real sun in the centre circle and tap **Set**. This also corrects magnetic declination.
   On a cloudy day, use the **North correction** slider in Settings instead.
4. Optional, once per phone: **Settings → Calibrate field of view** so that angles on screen match
   reality.
5. **Shade check** detects the sky in the camera image with simple colour rules (blue, or bright
   white/grey and smooth). The band stays orange where it crosses open sky and turns dark and
   hatched where a building, tree or the window frame blocks it. If some sky is shown as blocked
   (an overcast or hazy sky), tap on it to teach its colour. **Show detected sky** tints what the
   app considers sky in cyan, to check the detection.
6. **Freeze** holds the image so you can look at it without holding the phone steady.
   **Snapshot** saves or shares the image with the overlay.

To install it as an app: Chrome menu → **Add to Home screen**. It then works offline.

## Desktop demo

Open the page with `?demo` (or tap **Demo**) to see a simulated room with a south-west window
in Zürich. Drag (or use the arrow keys) to look around.

## Development

No build step: plain HTML, CSS and ES modules.

```
npm test                 # solar math and projection tests (Node 18+)
node serve.mjs           # serves on http://localhost:8000
```

Then open `http://localhost:8000/?demo`. Camera and sensors need HTTPS (or localhost), which
GitHub Pages provides.

When you change any file, bump `VERSION` in `sw.js` (and `js/app.js`) so installed copies update.

## Files

| File | Purpose |
|---|---|
| `js/solar.js` | NOAA solar position: declination, equation of time, azimuth/elevation |
| `js/period.js` | Period presets and the sky geometry (band, edge paths, monthly paths, hour lines) |
| `js/projection.js` | Camera model: orientation matrix, pinhole projection, horizon |
| `js/sensors.js` | Camera stream, orientation sensor, GPS |
| `js/render.js` | Overlay drawing and the demo scene |
| `js/segment.js` | Sky detection for the shade check |
| `js/app.js` | UI, settings, calibration, snapshot |
| `sw.js` | Offline cache |
