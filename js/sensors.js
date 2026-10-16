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
 * Stream orientation matrices to onMatrix(cols, source). Both Chrome APIs are started
 * together and the caller picks: AbsoluteOrientationSensor (fused rotation vector, the
 * same data native compass apps use) and the deviceorientationabsolute event.
 * Both are referenced to magnetic north.
 */
export function startOrientation(onMatrix, log = () => {}) {
  const stops = [];

  // Event API (no permission prompt on Android Chrome).
  const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  const handler = (e) => {
    if (e.alpha == null) return;
    if (evName === 'deviceorientation' && !e.absolute) return; // not compass-referenced
    const angle = (screen.orientation && screen.orientation.angle) || 0;
    onMatrix(eulerToCols(e.alpha, e.beta, e.gamma, angle), evName);
  };
  window.addEventListener(evName, handler);
  stops.push(() => window.removeEventListener(evName, handler));
  log(`Orientation: listening to ${evName}`);

  // Generic Sensor API.
  if ('AbsoluteOrientationSensor' in window) {
    const begin = () => {
      try {
        const sensor = new AbsoluteOrientationSensor({ frequency: 60, referenceFrame: 'screen' });
        sensor.addEventListener('reading', () => onMatrix(quatToCols(sensor.quaternion), 'AbsoluteOrientationSensor'));
        sensor.addEventListener('error', (e) => {
          log(`AbsoluteOrientationSensor error: ${e.error && e.error.name}: ${e.error && e.error.message}`);
        });
        sensor.start();
        stops.push(() => sensor.stop());
        log('Orientation: AbsoluteOrientationSensor started');
      } catch (err) {
        log(`AbsoluteOrientationSensor unavailable: ${err.name}: ${err.message}`);
      }
    };
    if (navigator.permissions) {
      Promise.all(['accelerometer', 'gyroscope', 'magnetometer'].map((name) =>
        navigator.permissions.query({ name }).then((r) => `${name}=${r.state}`, () => `${name}=?`)
      )).then((states) => { log(`Sensor permissions: ${states.join(', ')}`); begin(); });
    } else {
      begin();
    }
  } else {
    log('AbsoluteOrientationSensor not supported');
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
