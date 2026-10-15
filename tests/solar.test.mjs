// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { declEot, sunPosition, altAz } from '../js/solar.js';
import { periodDays, buildGeometry, presets } from '../js/period.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('declination extremes and equinox', () => {
  near(declEot(new Date(Date.UTC(2026, 5, 21, 12))).decl, 23.44, 0.05, 'June solstice');
  near(declEot(new Date(Date.UTC(2026, 11, 21, 12))).decl, -23.44, 0.05, 'December solstice');
  near(declEot(new Date(Date.UTC(2026, 2, 20, 14))).decl, 0, 0.1, 'March equinox');
});

test('equation of time extremes', () => {
  near(declEot(new Date(Date.UTC(2026, 10, 3, 12))).eot, 16.4, 0.2, 'early November');
  near(declEot(new Date(Date.UTC(2026, 1, 11, 12))).eot, -14.2, 0.2, 'mid February');
});

test('solar noon elevation in Zurich at solstices', () => {
  const lat = 47.37;
  near(altAz(lat, 23.44, 0).el, 90 - lat + 23.44, 1e-9, 'June noon');
  near(altAz(lat, 23.44, 0).az, 180, 1e-9, 'noon is due south');
  near(altAz(lat, -23.44, 0).el, 90 - lat - 23.44, 1e-9, 'December noon');
});

test('afternoon sun is in the west, morning in the east', () => {
  assert.ok(altAz(47, 0, 60).az > 180);
  assert.ok(altAz(47, 0, -60).az < 180);
  near(altAz(0, 0, 90).az, 270, 1e-6, 'equator equinox sunset due west');
});

test('real instant: Zurich 2026-06-21 13:30 CEST (11:30 UTC) is near the meridian', () => {
  const p = sunPosition(new Date(Date.UTC(2026, 5, 21, 11, 30)), 47.37, 8.54);
  near(p.el, 66, 0.6, 'elevation');
  near(p.az, 180, 6, 'azimuth');
});

test('periods wrap over new year', () => {
  const winter = presets(47)[1];
  const days = periodDays(winter, 2026);
  assert.equal(days[0].getMonth(), 11);
  assert.equal(days.at(-1).getMonth(), 2);
  assert.ok(days.length > 85 && days.length < 95);
});

test('full-year geometry spans both solstices', () => {
  const g = buildGeometry({ lat: 47.37, lon: 8.54, period: presets(47)[0] });
  near(g.dMax, 23.44, 0.05, 'max decl');
  near(g.dMin, -23.44, 0.05, 'min decl');
  assert.equal(g.edges[0].kind, 'high');
  assert.ok(g.hours.some((h) => h.h === 12));
  assert.ok(g.months.length >= 4 && g.months.some((m) => m.label.includes(' · ')));
});
