// Drawing: the sun-path overlay, and a synthetic room-with-window scene for demo mode.

import { enu } from './solar.js';

const COL = {
  band: 'rgb(255, 184, 48)',
  high: '#ffb020',
  low: '#6fd0ff',
  month: 'rgba(255,255,255,0.55)',
  hour: 'rgba(255,255,255,0.85)',
  horizon: 'rgba(255,255,255,0.7)',
  sun: '#ffe680',
  shadeCell: 'rgb(12, 12, 20)',
  hatch: 'rgb(150, 150, 170)',
};

const COMPASS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export class OverlayRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.w = w; this.h = h;
  }

  draw(cam, geo, opts) {
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!geo) return;

    const sky = cam.skyPolygon();

    // Band, drawn opaque into a layer and composited once so quads don't double up.
    const l = this.lctx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sky.length > 2) {
      l.save();
      clipPoly(l, sky);
      l.fillStyle = COL.band;
      const b = geo.band;
      if (opts.sky) this.drawShadeCells(l, cam, geo.grid, opts.sky);
      else for (let i = 0; i < b.length - 1; i++) {
        const c0 = b[i], c1 = b[i + 1];
        if (Math.max(c0.elHi, c1.elHi) < 0) continue;
        const p = [cam.project(c0.lo), cam.project(c0.hi), cam.project(c1.hi), cam.project(c1.lo)];
        if (p.some((q) => !q)) continue;
        l.beginPath();
        l.moveTo(...p[0]); l.lineTo(...p[1]); l.lineTo(...p[2]); l.lineTo(...p[3]);
        l.closePath();
        l.fill();
        l.strokeStyle = COL.band; l.lineWidth = 0.6; l.stroke(); // hide hairline seams
      }
      l.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = opts.sky ? Math.max(0.5, opts.bandAlpha ?? 0.3) : opts.bandAlpha ?? 0.3;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }

    // Detected sky (test view).
    if (opts.showMask && opts.sky) {
      const img = opts.sky.maskImage();
      if (img) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, this.w, this.h);
        ctx.restore();
      }
    }

    // Lines above the horizon.
    ctx.save();
    if (sky.length > 2) clipPoly(ctx, sky); else { ctx.beginPath(); ctx.rect(0, 0, 0, 0); ctx.clip(); }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const m of geo.months) polyline(ctx, cam, m.pts, COL.month, 1.2, [6, 6], false);
    if (opts.hourLines) for (const hr of geo.hours) for (const s of hr.segs) polyline(ctx, cam, s, COL.hour, 1.4);
    for (const e of geo.edges) polyline(ctx, cam, e.pts, e.kind === 'high' ? COL.high : COL.low, 3);
    ctx.restore();

    // Horizon and compass ticks.
    this.drawHorizon(cam);

    // Labels.
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const e of geo.edges) if (e.top.el > 0) label(ctx, cam, e.top.v, e.label, e.kind === 'high' ? COL.high : COL.low, -10);
    ctx.font = '500 11px system-ui, sans-serif';
    for (const m of geo.months) if (m.top.el > 0) label(ctx, cam, m.top.v, m.label, 'rgba(255,255,255,0.8)', -6);
    if (opts.hourLines) {
      ctx.font = '600 12px system-ui, sans-serif';
      for (const hr of geo.hours) {
        label(ctx, cam, hr.top.v, `${hr.h}h`, '#fff', -9);
        if (hr.bottom) label(ctx, cam, hr.bottom.v, `${hr.h}h`, '#fff', 17);
      }
    }

    // Current sun position (useful for calibration).
    if (opts.sunNow && opts.sunNow.el > -1) {
      const p = cam.project(enu(opts.sunNow.az, opts.sunNow.el));
      if (p) {
        ctx.beginPath(); ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
        ctx.strokeStyle = COL.sun; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
        ctx.fillStyle = COL.sun; ctx.fill();
        ctx.font = '600 11px system-ui, sans-serif';
        label(ctx, cam, enu(opts.sunNow.az, opts.sunNow.el), 'now', COL.sun, -18);
      }
    }
  }

  /** Band cells coloured by the sky mask: sun where open sky, grey where blocked. */
  drawShadeCells(l, cam, grid, sky) {
    const { nH, nD, v, el } = grid;
    const pts = new Array(v.length);
    for (let k = 0; k < v.length; k++) pts[k] = el[k] > -2 ? cam.project(v[k]) : null;
    const sun = [], shade = [];
    for (let j = 0; j < nD - 1; j++) {
      for (let i = 0; i < nH - 1; i++) {
        const a = j * nH + i, b = a + 1, c = a + nH + 1, d = a + nH;
        const pa = pts[a], pb = pts[b], pc = pts[c], pd = pts[d];
        if (!pa || !pb || !pc || !pd) continue;
        if (Math.max(el[a], el[b], el[c], el[d]) < 0) continue;
        const cx = (pa[0] + pb[0] + pc[0] + pd[0]) / 4, cy = (pa[1] + pb[1] + pc[1] + pd[1]) / 4;
        if (cx < -50 || cy < -50 || cx > cam.width + 50 || cy > cam.height + 50) continue;
        const s = sky.at(cam, cx, cy);
        (s === 0 ? shade : sun).push([pa, pb, pc, pd]);
      }
    }
    const path = (cells) => {
      l.beginPath();
      for (const [pa, pb, pc, pd] of cells) {
        l.moveTo(...pa); l.lineTo(...pb); l.lineTo(...pc); l.lineTo(...pd); l.closePath();
      }
    };
    path(sun);
    l.fillStyle = COL.band; l.strokeStyle = COL.band; l.lineWidth = 0.8;
    l.fill(); l.stroke();
    if (!shade.length) return;
    path(shade);
    l.fillStyle = COL.shadeCell; l.strokeStyle = COL.shadeCell;
    l.fill(); l.stroke();
    // Diagonal hatching so blocked parts read as "shade" at a glance.
    l.save();
    l.clip();
    l.strokeStyle = COL.hatch; l.lineWidth = 2;
    l.beginPath();
    const W = cam.width, H = cam.height;
    for (let x = -H; x < W; x += 12) { l.moveTo(x, 0); l.lineTo(x + H, H); }
    l.stroke();
    l.restore();
  }

  drawHorizon(cam) {
    const ctx = this.ctx;
    const pts = [];
    for (let az = 0; az <= 360; az += 2) pts.push({ v: enu(az, 0) });
    polyline(ctx, cam, pts, COL.horizon, 1.5);
    ctx.textAlign = 'center';
    for (let az = 0; az < 360; az += 5) {
      const p = cam.project(enu(az, 0));
      if (!p || p[0] < -20 || p[0] > this.w + 20 || p[1] < -20 || p[1] > this.h + 20) continue;
      const major = az % 15 === 0;
      const up = cam.project(enu(az, major ? 1.6 : 0.8));
      if (!up) continue;
      ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...up);
      ctx.strokeStyle = COL.horizon; ctx.lineWidth = major ? 1.5 : 1; ctx.stroke();
      if (COMPASS[az] !== undefined || az % 30 === 0) {
        const t = cam.project(enu(az, -2.2));
        if (!t) continue;
        ctx.font = COMPASS[az] ? '700 14px system-ui, sans-serif' : '500 11px system-ui, sans-serif';
        halo(ctx, COMPASS[az] ?? `${az}°`, t[0], t[1] + 5, COMPASS[az] ? '#fff' : 'rgba(255,255,255,0.8)');
      }
    }
  }
}

function polyline(ctx, cam, pts, color, width, dash, underStroke = true) {
  ctx.beginPath();
  let open = false, prev = null;
  const maxJump = Math.max(cam.width, cam.height) * 3;
  for (const pt of pts) {
    const p = cam.project(pt.v);
    if (!p || (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > maxJump)) {
      open = false; prev = p; continue;
    }
    if (open) ctx.lineTo(...p); else { ctx.moveTo(...p); open = true; }
    prev = p;
  }
  ctx.setLineDash(dash || []);
  // Dark under-stroke keeps lines readable on bright sky.
  if (underStroke) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = width + 2; ctx.stroke(); }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  ctx.setLineDash([]);
}

function label(ctx, cam, v, text, color, dy) {
  const p = cam.project(v);
  if (!p) return;
  halo(ctx, text, p[0], p[1] + dy, color);
}

function halo(ctx, text, x, y, color) {
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function clipPoly(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(...poly[0]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(...poly[i]);
  ctx.closePath();
  ctx.clip();
}

// ---------------------------------------------------------------------------
// Demo scene: standing in a room, looking through a south-west window at
// neighbouring buildings. Everything is defined in azimuth/elevation.

const WINDOW = { az0: 160, az1: 250, el0: -14, el1: 36 };
const BUILDINGS = [
  { az0: 140, az1: 176, el: 21, color: '#857a6e' },
  { az0: 176, az1: 194, el: 13, color: '#9c9184' },
  { az0: 194, az1: 213, el: 7, color: '#b3a796' },
  { az0: 236, az1: 262, el: 26, color: '#7d7469' },
];
const TREE = { az: 224, el: 9, r: 7 };

export function drawDemoScene(canvas, cam, dpr, sunNow) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cam.width, H = cam.height;

  // Room wall.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#4a443e'); g.addColorStop(1, '#2e2a26');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const outline = rectOutline(WINDOW.az0, WINDOW.az1, WINDOW.el0, WINDOW.el1);
  const win = projectPoly(cam, outline);
  if (!win) return;

  ctx.save();
  fillPoly(ctx, win, null); ctx.clip();

  // Sky with a gradient based on elevation of the screen top/bottom.
  const sg = ctx.createLinearGradient(0, 0, 0, H);
  sg.addColorStop(0, '#3f86d6'); sg.addColorStop(1, '#bcdcf5');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);

  // A couple of clouds.
  for (const c of [{ az: 185, el: 30, r: 5 }, { az: 230, el: 33, r: 4 }]) {
    const pts = [];
    for (let a = 0; a < 360; a += 15) pts.push(enu(c.az + c.r * 1.8 * Math.cos(a * Math.PI / 180), c.el + c.r * 0.5 * Math.sin(a * Math.PI / 180)));
    const p = projectPoly(cam, pts);
    if (p) fillPoly(ctx, p, 'rgba(255,255,255,0.85)');
  }

  // Real sun.
  if (sunNow && sunNow.el > 0) {
    const p = cam.project(enu(sunNow.az, sunNow.el));
    if (p) {
      const rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 60);
      rg.addColorStop(0, 'rgba(255,255,240,1)'); rg.addColorStop(0.2, 'rgba(255,250,210,0.9)'); rg.addColorStop(1, 'rgba(255,250,210,0)');
      ctx.fillStyle = rg; ctx.fillRect(p[0] - 60, p[1] - 60, 120, 120);
    }
  }

  // Ground below the horizon.
  const sky = cam.skyPolygon();
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H);
  if (sky.length > 2) { ctx.moveTo(...sky[0]); for (const p of sky.slice(1)) ctx.lineTo(...p); ctx.closePath(); }
  ctx.fillStyle = '#56603f'; ctx.fill('evenodd');
  ctx.restore();

  // Buildings with simple windows.
  for (const b of BUILDINGS) {
    const p = projectPoly(cam, rectOutline(b.az0, b.az1, -5, b.el));
    if (p) fillPoly(ctx, p, b.color);
    ctx.fillStyle = 'rgba(40,50,60,0.55)';
    for (let el = 2; el < b.el - 2; el += 4) {
      for (let az = b.az0 + 2; az < b.az1 - 2; az += 4) {
        const q = projectPoly(cam, rectOutline(az, az + 1.6, el, el + 2));
        if (q) fillPoly(ctx, q, null, true);
      }
    }
  }

  // Tree.
  const tree = [];
  for (let a = 0; a < 360; a += 12) {
    const r = TREE.r * (0.85 + 0.15 * Math.sin(a * 5 * Math.PI / 180));
    tree.push(enu(TREE.az + r * Math.cos(a * Math.PI / 180), TREE.el + r * Math.sin(a * Math.PI / 180)));
  }
  const tp = projectPoly(cam, tree);
  if (tp) fillPoly(ctx, tp, '#3d5a2e');
  const trunk = projectPoly(cam, rectOutline(TREE.az - 0.6, TREE.az + 0.6, -5, TREE.el - TREE.r + 1));
  if (trunk) fillPoly(ctx, trunk, '#4a3a2a');

  ctx.restore();

  // Window frame and mullion.
  ctx.lineJoin = 'round';
  strokePoly(ctx, win, '#bdb6aa', 10);
  const mid = (WINDOW.az0 + WINDOW.az1) / 2;
  const m = projectPoly(cam, [enu(mid, WINDOW.el0), enu(mid, WINDOW.el1)], false);
  if (m) { ctx.beginPath(); ctx.moveTo(...m[0]); ctx.lineTo(...m[1]); ctx.strokeStyle = '#bdb6aa'; ctx.lineWidth = 7; ctx.stroke(); }
}

function rectOutline(az0, az1, el0, el1) {
  const pts = [];
  for (let az = az0; az <= az1; az += 2) pts.push(enu(az, el1));
  for (let el = el1; el >= el0; el -= 2) pts.push(enu(az1, el));
  for (let az = az1; az >= az0; az -= 2) pts.push(enu(az, el0));
  for (let el = el0; el <= el1; el += 2) pts.push(enu(az0, el));
  return pts;
}

function projectPoly(cam, vs) {
  const out = [];
  for (const v of vs) { const p = cam.project(v); if (!p) return null; out.push(p); }
  return out;
}

function fillPoly(ctx, p, color, fillOnly) {
  ctx.beginPath();
  ctx.moveTo(...p[0]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(...p[i]);
  ctx.closePath();
  if (color) ctx.fillStyle = color;
  if (color || fillOnly) ctx.fill();
}

function strokePoly(ctx, p, color, width) {
  ctx.beginPath();
  ctx.moveTo(...p[0]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(...p[i]);
  ctx.closePath();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
