// Solar geometry (NOAA algorithm, accurate to well under 0.1° for 1900–2100).
// Angles in degrees. Azimuth is measured clockwise from true north.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Sun declination (deg) and equation of time (minutes) for a JS Date (instant). */
export function declEot(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;

  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);

  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;

  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot =
    4 *
    DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));

  return { decl, eot };
}

/** Hour angle (deg, 0 = solar noon, + = afternoon) for an instant at longitude lon. */
export function hourAngle(date, lon, eot) {
  const utcMin = (date.getTime() / 60000) % 1440;
  const tst = mod(utcMin + eot + 4 * lon, 1440); // true solar time, minutes
  return tst / 4 - 180;
}

/** Horizontal coordinates from latitude, declination and hour angle (geometric, no refraction). */
export function altAz(lat, decl, H) {
  const phi = lat * RAD, d = decl * RAD, h = H * RAD;
  const sinEl = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
  const el = Math.asin(clamp(sinEl, -1, 1)) * DEG;
  const az = mod(
    Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * DEG + 180,
    360
  );
  return { az, el };
}

/** Sun azimuth/elevation for an instant and location. */
export function sunPosition(date, lat, lon) {
  const { decl, eot } = declEot(date);
  return { ...altAz(lat, decl, hourAngle(date, lon, eot)), decl, eot };
}

/** Unit vector in local ENU frame (x = east, y = north, z = up). */
export function enu(az, el) {
  const a = az * RAD, e = el * RAD;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}

export function mod(a, n) {
  return ((a % n) + n) % n;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
