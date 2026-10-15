import { sunPosition } from './solar.js';
import { presets, fmtDay, buildGeometry } from './period.js';
import { Camera, angleBetween } from './projection.js';
import { startCamera, startOrientation, getLocation } from './sensors.js';
import { OverlayRenderer, drawDemoScene } from './render.js';

export const VERSION = '0.1.0';

const $ = (id) => document.getElementById(id);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const FALLBACK_LOC = { lat: 47.3769, lon: 8.5417, label: 'Zürich (default)' };

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  headingOffset: 0,
  fovLong: 67,
  periodId: 'year',
  custom: { from: { m: 11, d: 1 }, to: { m: 2, d: 28 } },
  hourLines: true,
  hourMode: 'clock',
  monthLines: true,
  sunNow: true,
  bandAlpha: 0.3,
  loc: null,
};
const settings = loadSettings();

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('sunpath.settings') || '{}');
    return { ...DEFAULTS, ...s };
  } catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem('sunpath.settings', JSON.stringify(settings)); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- state
const cam = new Camera();
cam.headingOffset = settings.headingOffset;
cam.fovLong = settings.fovLong;

const overlay = new OverlayRenderer($('overlay'));
const video = $('video');
const sceneCanvas = $('scene');

const state = {
  mode: null,            // 'camera' | 'demo'
  loc: settings.loc || null,
  locLabel: '',
  geo: null,
  sunNow: null,
  frozen: false,
  sensorSource: null,
  lastSensorAt: 0,
  manualLook: false,     // drag to look (demo, or no sensor)
  yaw: 205, pitch: 22,
  cal: null,             // calibration step
  fps: 0,
};

// ---------------------------------------------------------------- logging
const logLines = [];
function log(msg) {
  const t = new Date().toLocaleTimeString();
  logLines.push(`${t} ${msg}`);
  if (logLines.length > 60) logLines.shift();
  if (!$('debug').hidden) $('debugLog').textContent = logLines.join('\n');
}
window.addEventListener('error', (e) => log(`ERROR ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => log(`REJECTION ${e.reason?.message || e.reason}`));
for (const k of ['warn', 'error']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { log(`${k}: ${a.join(' ')}`); orig(...a); };
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- period
function currentPeriod() {
  const lat = state.loc?.lat ?? FALLBACK_LOC.lat;
  if (settings.periodId === 'custom') return { id: 'custom', name: 'Custom', ...settings.custom };
  return presets(lat).find((p) => p.id === settings.periodId) || presets(lat)[0];
}

function rebuild() {
  if (!state.loc) return;
  const p = currentPeriod();
  state.geo = buildGeometry({
    lat: state.loc.lat, lon: state.loc.lon, period: p,
    hourMode: settings.hourMode, monthLines: settings.monthLines,
  });
  $('periodName').textContent = p.name;
  $('periodDates').textContent = `${fmtDay(p.from)} – ${fmtDay(p.to)} · ${state.geo.nDays} days`;
}

function updateSunNow() {
  if (!state.loc) return;
  state.sunNow = sunPosition(new Date(), state.loc.lat, state.loc.lon);
}

// ---------------------------------------------------------------- start
async function start(mode) {
  state.mode = mode;
  $('start').hidden = true;
  $('topbar').hidden = false;
  $('hud').hidden = false;

  if (mode === 'camera') {
    try {
      await startCamera(video);
      const setSize = () => { cam.setVideoSize(video.videoWidth, video.videoHeight); log(`Video ${video.videoWidth}×${video.videoHeight}`); };
      video.addEventListener('loadedmetadata', setSize);
      video.addEventListener('resize', setSize);
      setSize();
    } catch (err) {
      log(`Camera failed: ${err.name}: ${err.message}`);
      toast('Camera not available, switching to demo mode.');
      return switchToDemo();
    }
    startOrientation((m, src) => {
      if (state.frozen || state.manualLook) return;
      cam.setSensorMatrix(m);
      state.lastSensorAt = performance.now();
      if (state.sensorSource !== src) { state.sensorSource = src; log(`First reading from ${src}`); }
    }, log);
    setTimeout(() => {
      if (!state.lastSensorAt) {
        state.manualLook = true;
        toast('No orientation sensor found. Drag to look around.', 4500);
        log('No orientation readings after 2.5 s → manual look');
      }
    }, 2500);
    locate();
  } else {
    switchToDemo();
  }
}

function switchToDemo() {
  state.mode = 'demo';
  state.manualLook = true;
  video.hidden = true;
  sceneCanvas.hidden = false;
  cam.setVideoSize(0, 0);
  if (!state.loc) setLoc(FALLBACK_LOC.lat, FALLBACK_LOC.lon, 'Zürich (demo)');
  toast('Demo: a south-west window in Zürich. Drag to look around.', 4500);
}

async function locate() {
  if (state.loc) { state.locLabel = 'saved'; rebuild(); }
  try {
    const p = await getLocation();
    setLoc(p.lat, p.lon, `GPS ±${Math.round(p.acc)} m`);
    settings.loc = { lat: p.lat, lon: p.lon }; saveSettings();
  } catch (err) {
    log(`Location failed: ${err.message}`);
    if (!state.loc) {
      setLoc(FALLBACK_LOC.lat, FALLBACK_LOC.lon, FALLBACK_LOC.label);
      toast('Location unavailable, using Zürich. Set it in Settings.', 4500);
    }
  }
}

function setLoc(lat, lon, label) {
  state.loc = { lat, lon };
  state.locLabel = label;
  updateSunNow();
  rebuild();
  syncSettingsUI();
}

// ---------------------------------------------------------------- layout & loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 3);
  cam.resize(w, h);
  overlay.resize(w, h, dpr);
  sceneCanvas.width = Math.round(w * dpr); sceneCanvas.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);
resize();

let lastT = performance.now(), frames = 0, fpsT = lastT;
function frame(t) {
  frames++;
  if (t - fpsT > 1000) { state.fps = frames; frames = 0; fpsT = t; }
  lastT = t;

  if (state.mode) {
    if (state.manualLook) cam.setYawPitch(state.yaw - settings.headingOffset, state.pitch);
    if (state.mode === 'demo') drawDemoScene(sceneCanvas, cam, overlay.dpr, state.sunNow);
    overlay.draw(cam, state.geo, {
      hourLines: settings.hourLines,
      bandAlpha: settings.bandAlpha,
      sunNow: settings.sunNow ? state.sunNow : null,
    });
    updateReadout();
    if (!$('debug').hidden) updateDebug();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(updateSunNow, 10000);

function updateReadout() {
  const f = cam.forward();
  const dir = COMPASS16[Math.round(f.az / 22.5) % 16];
  const loc = state.loc ? `${state.loc.lat.toFixed(3)}, ${state.loc.lon.toFixed(3)}` : 'locating…';
  const frozen = state.frozen ? ' · FROZEN' : '';
  $('readout').textContent = `${Math.round(f.az)}° ${dir} · elev ${Math.round(f.el)}° · ${loc}${frozen}`;
}

function updateDebug() {
  const m = cam.measuredForward(), f = cam.forward();
  $('debugInfo').textContent = [
    `Sun Path v${VERSION}  mode=${state.mode}  fps=${state.fps}`,
    `orientation: ${state.sensorSource || (state.manualLook ? 'manual drag' : 'waiting…')}`,
    `measured az ${m.az.toFixed(1)}  el ${m.el.toFixed(1)}  roll ${cam.roll().toFixed(1)}`,
    `corrected az ${f.az.toFixed(1)}  offset ${settings.headingOffset.toFixed(1)}`,
    `fovLong ${cam.fovLong.toFixed(1)}°  f ${cam.f.toFixed(0)} css px`,
    `video ${cam.video ? `${cam.video.w}×${cam.video.h}` : '–'}  screen ${cam.width}×${cam.height} @${overlay.dpr}x`,
    `loc ${state.loc ? `${state.loc.lat.toFixed(5)}, ${state.loc.lon.toFixed(5)}` : '–'} (${state.locLabel})`,
    `sun now az ${state.sunNow?.az.toFixed(1)} el ${state.sunNow?.el.toFixed(1)}`,
    `period decl ${state.geo?.dMin.toFixed(2)} … ${state.geo?.dMax.toFixed(2)}`,
    `tz ${Intl.DateTimeFormat().resolvedOptions().timeZone}  UTC${-new Date().getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-new Date().getTimezoneOffset() / 60}`,
    `secure=${window.isSecureContext}  AOS=${'AbsoluteOrientationSensor' in window}`,
  ].join('\n');
}

// ---------------------------------------------------------------- drag to look
let drag = null;
$('overlay').addEventListener('pointerdown', (e) => {
  if (!state.manualLook) return;
  drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch };
  $('overlay').setPointerCapture(e.pointerId);
});
$('overlay').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = 57.2958 / cam.f;
  state.yaw = (drag.yaw - (e.clientX - drag.x) * k + 360) % 360;
  state.pitch = Math.max(-80, Math.min(85, drag.pitch + (e.clientY - drag.y) * k));
});
$('overlay').addEventListener('pointerup', () => (drag = null));
$('overlay').addEventListener('pointercancel', () => (drag = null));
window.addEventListener('keydown', (e) => {
  if (!state.manualLook) return;
  const s = e.shiftKey ? 5 : 1;
  if (e.key === 'ArrowLeft') state.yaw = (state.yaw - s + 360) % 360;
  if (e.key === 'ArrowRight') state.yaw = (state.yaw + s) % 360;
  if (e.key === 'ArrowUp') state.pitch = Math.min(85, state.pitch + s);
  if (e.key === 'ArrowDown') state.pitch = Math.max(-80, state.pitch - s);
});

// ---------------------------------------------------------------- calibration
function beginCal(kind) {
  closeSheets();
  state.cal = { kind, step: 1 };
  $('calBanner').hidden = false;
  $('edgeMarker').hidden = true;
  if (kind === 'sun') {
    if (!state.sunNow || state.sunNow.el < 1) {
      state.cal = null; $('calBanner').hidden = true;
      return toast('The sun is below the horizon now. Use the North correction slider instead.', 4500);
    }
    $('calText').innerHTML = 'Put the <b>real sun</b> in the centre circle (look at the screen, not at the sun), then tap <b>Set</b>.';
    $('calSet').textContent = 'Set';
  } else {
    $('calText').innerHTML = 'Step 1/2: put a <b>distant, distinct object</b> (a chimney, a corner) in the centre circle, then tap <b>Mark</b>.';
    $('calSet').textContent = 'Mark';
  }
}

function setCal() {
  const c = state.cal;
  if (!c) return;
  if (c.kind === 'sun') {
    const m = cam.measuredForward();
    let off = state.sunNow.az - m.az;
    off = ((off + 540) % 360) - 180;
    settings.headingOffset = Math.round(off * 10) / 10;
    applyCalibration();
    const dEl = state.sunNow.el - m.el;
    toast(`North correction set to ${settings.headingOffset.toFixed(1)}°` +
      (Math.abs(dEl) > 3 ? `. Elevation is off by ${dEl.toFixed(1)}°; check the field of view.` : '.'), 5000);
    endCal();
  } else if (c.step === 1) {
    c.v1 = cam.raw[2].map((v) => -v);
    c.step = 2;
    $('calText').innerHTML = 'Step 2/2: turn the phone <b>right</b> until the same object touches the <b style="color:var(--accent)">◀</b> marker on the left edge, then tap <b>Mark</b>.';
    $('edgeMarker').hidden = false;
  } else {
    const v2 = cam.raw[2].map((v) => -v);
    const ang = angleBetween(c.v1, v2);
    if (ang < 5) { toast('Turned too little. Try again.'); return; }
    const markerX = $('edgeMarker').getBoundingClientRect();
    const dx = cam.width / 2 - (markerX.left + markerX.width / 2);
    cam.setFocal(dx / Math.tan(ang * Math.PI / 180));
    settings.fovLong = Math.round(cam.fovLong * 10) / 10;
    applyCalibration();
    toast(`Field of view set to ${settings.fovLong.toFixed(1)}°.`);
    endCal();
  }
}

function endCal() {
  state.cal = null;
  $('calBanner').hidden = true;
  $('edgeMarker').hidden = true;
}

function applyCalibration() {
  cam.headingOffset = settings.headingOffset;
  cam.fovLong = settings.fovLong;
  cam.updateFocal();
  cam.applyOffset();
  saveSettings();
  syncSettingsUI();
}

$('calBtn').onclick = () => beginCal('sun');
$('calSunBtn').onclick = () => beginCal('sun');
$('calFovBtn').onclick = () => beginCal('fov');
$('calSet').onclick = setCal;
$('calCancel').onclick = endCal;

// ---------------------------------------------------------------- freeze & snapshot
$('freezeBtn').onclick = () => {
  state.frozen = !state.frozen;
  $('freezeBtn').classList.toggle('on', state.frozen);
  $('freezeBtn').textContent = state.frozen ? 'Live' : 'Freeze';
  if (state.mode === 'camera') state.frozen ? video.pause() : video.play();
};

$('snapBtn').onclick = async () => {
  const dpr = overlay.dpr;
  const out = document.createElement('canvas');
  out.width = $('overlay').width; out.height = $('overlay').height;
  const ctx = out.getContext('2d');
  if (state.mode === 'camera' && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.max(out.width / vw, out.height / vh);
    ctx.drawImage(video, (out.width - vw * k) / 2, (out.height - vh * k) / 2, vw * k, vh * k);
  } else {
    ctx.drawImage(sceneCanvas, 0, 0);
  }
  ctx.drawImage($('overlay'), 0, 0);
  // Caption.
  const p = currentPeriod(), f = cam.forward();
  const text = `${p.name} (${fmtDay(p.from)} – ${fmtDay(p.to)}) · facing ${Math.round(f.az)}° · ` +
    `${state.loc.lat.toFixed(4)}, ${state.loc.lon.toFixed(4)} · ${new Date().toLocaleString()}`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, cam.height - 28, cam.width, 28);
  ctx.fillStyle = '#fff'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(text, 8, cam.height - 10, cam.width - 16);

  const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.9));
  const name = `sunpath-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jpg`;
  const file = new File([blob], name, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sun path' });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    log(`Share failed: ${err.message}`);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

$('debugBtn').onclick = () => {
  $('debug').hidden = !$('debug').hidden;
  $('debugBtn').classList.toggle('on', !$('debug').hidden);
  $('debugLog').textContent = logLines.join('\n');
};

// ---------------------------------------------------------------- sheets
function closeSheets() { for (const s of document.querySelectorAll('.sheet')) s.hidden = true; }
function openSheet(id) { closeSheets(); $(id).hidden = false; }
for (const b of document.querySelectorAll('[data-close]')) b.onclick = closeSheets;
$('periodBtn').onclick = () => { renderPeriodSheet(); openSheet('periodSheet'); };
$('settingsBtn').onclick = () => { syncSettingsUI(); openSheet('settingsSheet'); };
$('overlay').addEventListener('click', () => { if (!state.manualLook) closeSheets(); });

function renderPeriodSheet() {
  const lat = state.loc?.lat ?? FALLBACK_LOC.lat;
  const chips = $('presetChips');
  chips.innerHTML = '';
  for (const p of [...presets(lat), { id: 'custom', name: 'Custom' }]) {
    const b = document.createElement('button');
    b.className = 'chip' + (settings.periodId === p.id ? ' on' : '');
    b.textContent = p.name;
    b.onclick = () => { settings.periodId = p.id; saveSettings(); rebuild(); renderPeriodSheet(); };
    chips.appendChild(b);
  }
  $('customRow').hidden = settings.periodId !== 'custom';
  $('fromD').value = settings.custom.from.d; $('fromM').value = settings.custom.from.m;
  $('toD').value = settings.custom.to.d; $('toM').value = settings.custom.to.m;
  $('optHours').checked = settings.hourLines;
  $('optHourMode').value = settings.hourMode;
  $('optMonths').checked = settings.monthLines;
  $('optSun').checked = settings.sunNow;
  $('optAlpha').value = settings.bandAlpha;
}

for (const id of ['fromM', 'toM']) {
  $(id).innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
}
function readCustom() {
  const day = (v, m) => Math.max(1, Math.min(new Date(2025, m, 0).getDate(), parseInt(v, 10) || 1));
  const fm = +$('fromM').value, tm = +$('toM').value;
  settings.custom = { from: { m: fm, d: day($('fromD').value, fm) }, to: { m: tm, d: day($('toD').value, tm) } };
  saveSettings(); rebuild();
}
for (const id of ['fromD', 'fromM', 'toD', 'toM']) $(id).addEventListener('change', readCustom);
$('optHours').onchange = (e) => { settings.hourLines = e.target.checked; saveSettings(); };
$('optHourMode').onchange = (e) => { settings.hourMode = e.target.value; saveSettings(); rebuild(); };
$('optMonths').onchange = (e) => { settings.monthLines = e.target.checked; saveSettings(); rebuild(); };
$('optSun').onchange = (e) => { settings.sunNow = e.target.checked; saveSettings(); };
$('optAlpha').oninput = (e) => { settings.bandAlpha = +e.target.value; saveSettings(); };

function syncSettingsUI() {
  $('offsetIn').value = settings.headingOffset;
  $('offsetOut').textContent = `${settings.headingOffset > 0 ? '+' : ''}${settings.headingOffset.toFixed(1)}°`;
  $('fovIn').value = settings.fovLong;
  $('fovOut').textContent = `${settings.fovLong.toFixed(1)}°`;
  if (state.loc) { $('latIn').value = state.loc.lat.toFixed(5); $('lonIn').value = state.loc.lon.toFixed(5); }
  $('locInfo').textContent = state.loc ? `Using ${state.loc.lat.toFixed(4)}, ${state.loc.lon.toFixed(4)} (${state.locLabel}).` : 'No location yet.';
  $('versionInfo').textContent = `Sun Path v${VERSION}`;
}
$('offsetIn').oninput = (e) => { settings.headingOffset = +e.target.value; applyCalibration(); };
$('fovIn').oninput = (e) => { settings.fovLong = +e.target.value; applyCalibration(); };
$('gpsBtn').onclick = () => { $('locInfo').textContent = 'Locating…'; locate(); };
$('locApply').onclick = () => {
  const lat = parseFloat($('latIn').value), lon = parseFloat($('lonIn').value);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return toast('Invalid coordinates.');
  setLoc(lat, lon, 'manual');
  settings.loc = { lat, lon }; saveSettings();
  toast('Location updated.');
};
$('resetBtn').onclick = () => {
  settings.headingOffset = DEFAULTS.headingOffset;
  settings.fovLong = DEFAULTS.fovLong;
  applyCalibration();
  toast('Calibration reset.');
};
$('updateBtn').onclick = async () => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (err) { log(`Update: ${err.message}`); }
  location.reload();
};

// ---------------------------------------------------------------- boot
$('startBtn').onclick = () => start('camera');
$('demoBtn').onclick = () => start('demo');
if (new URLSearchParams(location.search).has('demo')) start('demo');

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch((err) => log(`SW: ${err.message}`));
}
syncSettingsUI();
log(`Sun Path v${VERSION} loaded`);
