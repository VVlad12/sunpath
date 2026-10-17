// Device inputs: back camera, orientation (compass-referenced) and location.

import { quatToCols, eulerToCols } from './projection.js';

/** Start the back camera in a <video> element. Resolves with the MediaStream. */
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

/**
 * Orientation in two flavours, each as a device→world matrix (columns, screen axes):
 *  - onAbsolute(cols, src): compass-referenced (magnetic north). Accurate on average but
 *    pulled around indoors by steel, radiators and cables.
 *  - onRelative(cols, src): gyroscope + accelerometer only (Android "game rotation vector").
 *    Smooth and immune to magnetic disturbance, but its north is arbitrary and drifts slowly.
 * For each flavour the Generic Sensor API is preferred; the matching DeviceOrientation
 * event is used only if that sensor never delivers, so sources are never mixed.
 */
export function startOrientation({ onAbsolute, onRelative }, log = () => {}) {
  const stops = [];
  const seen = { abs: false, rel: false };

  const listen = (evName, kind, cb, accept) => {
    const handler = (e) => {
      if (e.alpha == null || seen[kind] || !accept(e)) return;
      const angle = (screen.orientation && screen.orientation.angle) || 0;
      cb(eulerToCols(e.alpha, e.beta, e.gamma, angle), evName);
    };
    window.addEventListener(evName, handler);
    stops.push(() => window.removeEventListener(evName, handler));
  };
  if ('ondeviceorientationabsolute' in window) listen('deviceorientationabsolute', 'abs', onAbsolute, () => true);
  else listen('deviceorientation', 'abs', onAbsolute, (e) => e.absolute);
  listen('deviceorientation', 'rel', onRelative, (e) => !e.absolute);

  const startSensor = (Ctor, name, kind, cb) => {
    if (!(Ctor in window)) { log(`${name} not supported`); return; }
    try {
      const sensor = new window[Ctor]({ frequency: 60, referenceFrame: 'screen' });
      sensor.addEventListener('reading', () => { seen[kind] = true; cb(quatToCols(sensor.quaternion), name); });
      sensor.addEventListener('error', (e) => log(`${name} error: ${e.error && e.error.name}: ${e.error && e.error.message}`));
      sensor.start();
      stops.push(() => sensor.stop());
      log(`${name} started`);
    } catch (err) {
      log(`${name} unavailable: ${err.name}: ${err.message}`);
    }
  };
  const begin = () => {
    startSensor('AbsoluteOrientationSensor', 'AbsoluteOrientationSensor', 'abs', onAbsolute);
    startSensor('RelativeOrientationSensor', 'RelativeOrientationSensor', 'rel', onRelative);
  };
  if (navigator.permissions) {
    Promise.all(['accelerometer', 'gyroscope', 'magnetometer'].map((name) =>
      navigator.permissions.query({ name }).then((r) => `${name}=${r.state}`, () => `${name}=?`)
    )).then((states) => { log(`Sensor permissions: ${states.join(', ')}`); begin(); });
  } else {
    begin();
  }
  return () => stops.forEach((s) => s());
}

/** One-shot high-accuracy location. */
export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 600000 }
    );
  });
}
