import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, quatToCols, eulerToCols } from '../js/projection.js';
import { enu } from '../js/solar.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('looking south at the horizon puts due south in the centre', () => {
  const cam = new Camera();
  cam.resize(400, 800);
  cam.setYawPitch(180, 0);
  const [x, y] = cam.project(enu(180, 0));
  near(x, 200, 1e-6, 'x'); near(y, 400, 1e-6, 'y');
  // West is to the right, higher elevation is up.
  assert.ok(cam.project(enu(190, 0))[0] > 200);
  assert.ok(cam.project(enu(180, 10))[1] < 400);
  assert.equal(cam.project(enu(0, 0)), null, 'north is behind');
});

test('heading offset rotates the view', () => {
  const cam = new Camera();
  cam.resize(400, 800);
  cam.setYawPitch(170, 0);
  cam.headingOffset = 10;
  cam.applyOffset();
  near(cam.forward().az, 180, 1e-6, 'corrected azimuth');
  near(cam.measuredForward().az, 170, 1e-6, 'measured azimuth');
});

test('sky polygon is the upper half when looking at the horizon', () => {
  const cam = new Camera();
  cam.resize(400, 800);
  cam.setYawPitch(90, 0);
  const ys = cam.skyPolygon().map((p) => p[1]);
  near(Math.max(...ys), 400, 1e-6, 'horizon through centre');
});

test('quaternion and euler agree: phone upright facing east', () => {
  // Upright portrait phone, back camera facing east: beta = 90, alpha = 270 (alpha is CCW from north).
  const e = eulerToCols(270, 90, 0);
  const s = Math.SQRT1_2;
  // Same rotation as a quaternion: Rz(270°) * Rx(90°).
  const qz = [0, 0, Math.sin((270 / 2) * Math.PI / 180), Math.cos((270 / 2) * Math.PI / 180)];
  const qx = [s, 0, 0, s];
  const q = [
    qz[3] * qx[0] + qz[0] * qx[3] + qz[1] * qx[2] - qz[2] * qx[1],
    qz[3] * qx[1] - qz[0] * qx[2] + qz[1] * qx[3] + qz[2] * qx[0],
    qz[3] * qx[2] + qz[0] * qx[1] - qz[1] * qx[0] + qz[2] * qx[3],
    qz[3] * qx[3] - qz[0] * qx[0] - qz[1] * qx[1] - qz[2] * qx[2],
  ];
  const m = quatToCols(q);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(m[i][j], e[i][j], 1e-9, `m${i}${j}`);
  const cam = new Camera();
  cam.setSensorMatrix(e, 0);
  near(cam.forward().az, 90, 1e-6, 'faces east');
  near(cam.forward().el, 0, 1e-6, 'level');
});

test('yawBetween recovers the azimuth offset between two orientations', async () => {
  const { yawBetween } = await import('../js/projection.js');
  for (const [alpha, beta, gamma, d] of [[10, 80, 5, 37], [200, 30, -20, -12.5], [90, 95, 0, 170]]) {
    const rel = eulerToCols(alpha, beta, gamma);
    const abs = eulerToCols(alpha - d, beta, gamma); // alpha is counter-clockwise, azimuth clockwise
    near(yawBetween(rel, abs), d, 1e-6, `offset ${d}`);
  }
});
