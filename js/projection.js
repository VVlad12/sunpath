// Camera model: orientation as a rotation matrix whose columns are the screen axes
// (right, up, toward-viewer) expressed in the local ENU world frame, plus a pinhole
// projection. The back camera looks along -z (away from the viewer).

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export class Camera {
  constructor() {
    this.cols = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]; // looking north at the horizon
    this.raw = null;          // last sensor matrix before smoothing
    this.headingOffset = 0;   // deg, added to measured azimuths (north correction)
    this.fovLong = 67;        // deg, field of view across the long side of the camera frame
    this.width = 1; this.height = 1;
    this.video = null;        // {w, h} of the camera frame when a camera is shown
    this.f = 1;
  }

  resize(w, h) { this.width = w; this.height = h; this.updateFocal(); }

  setVideoSize(w, h) { this.video = w && h ? { w, h } : null; this.updateFocal(); }

  /** Focal length in CSS pixels, matching the camera frame drawn with object-fit: cover. */
  updateFocal() {
    const t = Math.tan((this.fovLong / 2) * RAD);
    if (this.video) {
      const { w, h } = this.video;
      const k = Math.max(this.width / w, this.height / h);
      this.f = (Math.max(w, h) / 2 / t) * k;
    } else {
      this.f = Math.max(this.width, this.height) / 2 / t;
    }
  }

  /** Inverse of updateFocal: set fovLong from a focal length in CSS pixels. */
  setFocal(f) {
    let longPx = Math.max(this.width, this.height);
    if (this.video) {
      const { w, h } = this.video;
      longPx = Math.max(w, h) * Math.max(this.width / w, this.height / h);
    }
    this.fovLong = 2 * Math.atan(longPx / 2 / f) * DEG;
    this.updateFocal();
  }

  /** Sensor input as a device→world rotation matrix (columns), already in screen axes. */
  setSensorMatrix(m, smoothing = 0.35) {
    if (!this.raw) this.raw = m.map((c) => c.slice());
    else {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        this.raw[i][j] += (m[i][j] - this.raw[i][j]) * (1 - smoothing);
      }
      orthonormalize(this.raw);
    }
    this.applyOffset();
  }

  /** Manual look direction (demo mode): yaw = azimuth, pitch = elevation, deg. */
  setYawPitch(yaw, pitch) {
    const y = yaw * RAD, p = pitch * RAD;
    const fwd = [Math.cos(p) * Math.sin(y), Math.cos(p) * Math.cos(y), Math.sin(p)];
    const right = [Math.cos(y), -Math.sin(y), 0];
    const up = cross(right, fwd);
    this.raw = [right, up, fwd.map((v) => -v)];
    this.applyOffset();
  }

  applyOffset() {
    if (!this.raw) return;
    const d = this.headingOffset * RAD, c = Math.cos(d), s = Math.sin(d);
    this.cols = this.raw.map(([e, n, u]) => [e * c + n * s, -e * s + n * c, u]);
  }

  /** Azimuth/elevation of the screen centre, without the heading offset. */
  measuredForward() {
    const f = this.raw ? this.raw[2].map((v) => -v) : [0, 1, 0];
    return { az: ((Math.atan2(f[0], f[1]) * DEG) + 360) % 360, el: Math.asin(f[2]) * DEG };
  }

  /** Azimuth/elevation of the screen centre, corrected. */
  forward() {
    const f = this.cols[2].map((v) => -v);
    return { az: ((Math.atan2(f[0], f[1]) * DEG) + 360) % 360, el: Math.asin(f[2]) * DEG };
  }

  /** Roll of the screen around the view axis (deg), 0 = held upright. */
  roll() {
    const [r, u] = this.cols;
    return Math.atan2(r[2], u[2]) * DEG;
  }

  /** World unit vector → [x, y] in CSS pixels, or null when (nearly) behind the camera. */
  project(v) {
    const [r, u, b] = this.cols;
    const z = -(b[0] * v[0] + b[1] * v[1] + b[2] * v[2]);
    if (z < 0.03) return null;
    const x = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    const y = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    return [this.width / 2 + (this.f * x) / z, this.height / 2 - (this.f * y) / z];
  }

  /** Screen point → world unit vector. */
  unproject(px, py) {
    const [r, u, b] = this.cols;
    const x = (px - this.width / 2) / this.f, y = -(py - this.height / 2) / this.f;
    const v = [0, 1, 2].map((i) => r[i] * x + u[i] * y - b[i]);
    const n = Math.hypot(...v);
    return v.map((c) => c / n);
  }

  /** Polygon of the screen area above the horizon (the horizon is a straight line on screen). */
  skyPolygon() {
    const [r, u, b] = this.cols;
    const cx = this.width / 2, cy = this.height / 2, f = this.f;
    // Point (x, y) is above the horizon when its viewing ray has a positive up component.
    const side = ([x, y]) => (x - cx) * r[2] - (y - cy) * u[2] - f * b[2];
    const rect = [[0, 0], [this.width, 0], [this.width, this.height], [0, this.height]];
    const out = [];
    for (let i = 0; i < 4; i++) {
      const p = rect[i], q = rect[(i + 1) % 4];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  }
}

/** Device→world matrix from a unit quaternion [x, y, z, w] (Generic Sensor API order). */
export function quatToCols([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/** Device→world matrix from DeviceOrientation angles, rotated for the screen orientation. */
export function eulerToCols(alpha, beta, gamma, screenAngle = 0) {
  const R = mul(mul(rotZ(alpha), rotX(beta)), rotY(gamma));
  const S = mul(R, rotZ(-screenAngle));
  return [0, 1, 2].map((j) => [S[0][j], S[1][j], S[2][j]]);
}

function rotZ(a) { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
function rotX(a) { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
function rotY(a) { const c = Math.cos(a * RAD), s = Math.sin(a * RAD); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
function mul(A, B) {
  return A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function angleBetween(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
}

function orthonormalize(c) {
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  c[2] = n(c[2]);
  const d = c[1][0] * c[2][0] + c[1][1] * c[2][1] + c[1][2] * c[2][2];
  c[1] = n(c[1].map((v, i) => v - d * c[2][i]));
  c[0] = cross(c[1], c[2]);
}
