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
 * Stream orientation matrices to onMatrix(cols, source).
 * Prefers AbsoluteOrientationSensor (fused rotation vector, same as native apps),
 * falls back to the deviceorientationabsolute event.
 */
export function startOrientation(onMatrix, log = () => {}) {
  let stopped = false;
  let stop = () => { stopped = true; };

  const fallback = () => {
    if (stopped) return;
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    log(`Orientation: using ${evName} event`);
    const handler = (e) => {
      if (e.alpha == null) return;
      if (evName === 'deviceorientation' && !e.absolute) return; // not compass-referenced
      const angle = (screen.orientation && screen.orientation.angle) || 0;
      onMatrix(eulerToCols(e.alpha, e.beta, e.gamma, angle), evName);
    };
    window.addEventListener(evName, handler);
    stop = () => window.removeEventListener(evName, handler);
  };

  if ('AbsoluteOrientationSensor' in window) {
    try {
      const sensor = new AbsoluteOrientationSensor({ frequency: 60, referenceFrame: 'screen' });
      sensor.addEventListener('reading', () => onMatrix(quatToCols(sensor.quaternion), 'AbsoluteOrientationSensor'));
      sensor.addEventListener('error', (e) => {
        log(`AbsoluteOrientationSensor error: ${e.error && e.error.name}: ${e.error && e.error.message}`);
        sensor.stop();
        fallback();
      });
      sensor.start();
      log('Orientation: AbsoluteOrientationSensor started');
      stop = () => sensor.stop();
    } catch (err) {
      log(`AbsoluteOrientationSensor unavailable: ${err.message}`);
      fallback();
    }
  } else {
    fallback();
  }
  return () => stop();
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
