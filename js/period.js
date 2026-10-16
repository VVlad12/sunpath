// Periods (day ranges within a year) and the sky geometry derived from them:
// the envelope band between the extreme sun paths, monthly paths and hour lines.

import { declEot, altAz, sunPosition, enu } from './solar.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Preset periods; months are 1-based. Season names follow the hemisphere. */
export function presets(lat) {
  const south = lat < 0;
  const s = (north, southName) => (south ? southName : north);
  return [
    { id: 'year', name: 'Full year', from: { m: 1, d: 1 }, to: { m: 12, d: 31 } },
    { id: 'djf', name: s('Winter', 'Summer'), from: { m: 12, d: 21 }, to: { m: 3, d: 20 } },
    { id: 'mam', name: s('Spring', 'Autumn'), from: { m: 3, d: 20 }, to: { m: 6, d: 21 } },
    { id: 'jja', name: s('Summer', 'Winter'), from: { m: 6, d: 21 }, to: { m: 9, d: 22 } },
    { id: 'son', name: s('Autumn', 'Spring'), from: { m: 9, d: 22 }, to: { m: 12, d: 21 } },
    { id: 'heat', name: 'Heating season', from: s({ m: 10, d: 1 }, { m: 4, d: 1 }), to: s({ m: 4, d: 30 }, { m: 10, d: 31 }) },
  ];
}

export function fmtDay({ m, d }) {
  return `${d} ${MONTHS[m - 1]}`;
}

/** Local-noon Date objects for every day of the period (wraps over new year). */
export function periodDays(period, year = new Date().getFullYear()) {
  const start = new Date(year, period.from.m - 1, period.from.d, 12);
  let end = new Date(year, period.to.m - 1, period.to.d, 12);
  if (end < start) end = new Date(year + 1, period.to.m - 1, period.to.d, 12);
  const days = [];
  for (let t = new Date(start); t <= end; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 12)) {
    days.push(t);
  }
  return days;
}

/**
 * Build everything the overlay draws, as unit ENU vectors (cached until inputs change).
 * hourMode: 'clock' (local clock incl. DST) or 'standard' (no DST shift).
 */
export function buildGeometry({ lat, lon, period, hourMode = 'clock', monthLines = true }) {
  const days = periodDays(period);
  const decls = days.map((d) => declEot(d).decl);

  let iMax = 0, iMin = 0;
  decls.forEach((v, i) => {
    if (v > decls[iMax]) iMax = i;
    if (v < decls[iMin]) iMin = i;
  });
  const dMax = decls[iMax], dMin = decls[iMin];
  const label = (d) => fmtDay({ m: d.getMonth() + 1, d: d.getDate() });

  // Band: columns of constant hour angle between the two extreme declinations.
  // Hour circles are great circles, so each column projects to a straight-edged quad.
  const band = [];
  for (let H = -180; H <= 180; H += 2) {
    const a = altAz(lat, dMin, H), b = altAz(lat, dMax, H);
    band.push({ lo: enu(a.az, a.el), hi: enu(b.az, b.el), elLo: a.el, elHi: b.el });
  }

  // Finer grid over the same band (about 1° of declination × 2° of hour angle) for the
  // shade check, which colours each cell by what the camera sees there.
  const nD = Math.max(2, Math.ceil((dMax - dMin) / 1));
  const grid = { nH: band.length, nD: nD + 1, v: [], el: [] };
  for (let j = 0; j <= nD; j++) {
    const dec = dMin + ((dMax - dMin) * j) / nD;
    for (let H = -180; H <= 180; H += 2) {
      const p = altAz(lat, dec, H);
      grid.v.push(enu(p.az, p.el));
      grid.el.push(p.el);
    }
  }

  const arc = (decl) => {
    const pts = [];
    for (let H = -180; H <= 180; H += 1) {
      const p = altAz(lat, decl, H);
      pts.push({ v: enu(p.az, p.el), el: p.el });
    }
    const noon = altAz(lat, decl, 0);
    return { pts, top: { v: enu(noon.az, noon.el), el: noon.el } };
  };

  // Higher sun path is the "summer" edge in either hemisphere.
  const hiDecl = lat >= 0 ? dMax : dMin;
  const loDecl = lat >= 0 ? dMin : dMax;
  const hiDay = days[lat >= 0 ? iMax : iMin];
  const loDay = days[lat >= 0 ? iMin : iMax];
  const edges = [
    { ...arc(hiDecl), label: label(hiDay), kind: 'high' },
    { ...arc(loDecl), label: label(loDay), kind: 'low' },
  ];

  // Thin paths on the 21st of each month inside the period.
  const months = [];
  if (monthLines) {
    days.forEach((d, i) => {
      if (d.getDate() !== 21) return;
      const dec = decls[i];
      if (Math.abs(dec - dMax) < 1.5 || Math.abs(dec - dMin) < 1.5) return;
      // Months mirrored around a solstice (21 May / 21 Jul) share almost the same path.
      const twin = months.find((m) => Math.abs(m.decl - dec) < 1.5);
      if (twin) { twin.label += ` · ${label(d)}`; return; }
      months.push({ ...arc(dec), decl: dec, label: label(d) });
    });
  }

  // Hour lines: sun position at each full hour across the period.
  const step = days.length > 60 ? 3 : 1;
  const stdOffset = Math.max(
    new Date(days[0].getFullYear(), 0, 1).getTimezoneOffset(),
    new Date(days[0].getFullYear(), 6, 1).getTimezoneOffset()
  );
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const segs = [];
    let seg = null, prevOff = null;
    for (let i = 0; i < days.length; i += step) {
      const d = days[i];
      let t;
      if (hourMode === 'standard') {
        t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), h) + stdOffset * 60000);
      } else {
        t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
      }
      const off = t.getTimezoneOffset();
      const p = sunPosition(t, lat, lon);
      const brk = p.el < -1 || (hourMode === 'clock' && prevOff !== null && off !== prevOff);
      if (brk && seg) {
        if (seg.length > 1) segs.push(seg);
        seg = null;
      }
      if (p.el >= -1) {
        if (!seg) seg = [];
        seg.push({ v: enu(p.az, p.el), el: p.el });
      }
      prevOff = off;
    }
    if (seg && seg.length > 1) segs.push(seg);
    if (!segs.length) continue;
    // Label at the highest point of the line.
    // Labels at the highest and lowest point of the line (the low end is often the one in view).
    let top = null, bottom = null;
    for (const s of segs) for (const p of s) {
      if (!top || p.el > top.el) top = p;
      if (p.el > 0.5 && (!bottom || p.el < bottom.el)) bottom = p;
    }
    if (bottom && top.el - bottom.el < 8) bottom = null;
    if (top.el > 0.5) hours.push({ h, segs, top, bottom });
  }

  return {
    band, grid, edges, months, hours,
    dMax, dMin,
    nDays: days.length,
  };
}
