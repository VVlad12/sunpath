// Sky detection with simple colour rules, on a small screen-aligned copy of the frame.
//
// 1. Candidate pixels: smooth (no edges nearby) and sky-coloured — blue, very bright
//    white/grey (clouds, or sky blown out when seen from a dark room), or close to a
//    colour the user tapped as sky.
// 2. Candidates are grouped into connected regions. A region counts as sky when it lies
//    mostly above the horizon and contains blue, is very bright, or holds a tapped point.

const WORK_W = 144; // analysis width in pixels (height follows the screen aspect ratio)

export class SkySegmenter {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.maskCanvas = document.createElement('canvas');
    this.mask = null;      // Uint8Array, 1 = sky
    this.samples = [];     // [r, g, b] colours tapped as sky
    this.seeds = [];       // world unit vectors tapped as sky
    this.ms = 0;           // last processing time
  }

  /** Analyse the current frame. source: <video> (drawn with object-fit: cover) or a canvas. */
  process(source, cam) {
    const t0 = performance.now();
    const W = WORK_W, H = Math.max(1, Math.round((WORK_W * cam.height) / cam.width));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = this.maskCanvas.width = W;
      this.canvas.height = this.maskCanvas.height = H;
      this.mask = new Uint8Array(W * H);
      this.labels = new Int32Array(W * H);
      this.cand = new Uint8Array(W * H);
      this.luma = new Float32Array(W * H);
    }
    this.W = W; this.H = H;
    const ctx = this.ctx;
    if (source instanceof HTMLVideoElement) {
      const vw = source.videoWidth, vh = source.videoHeight;
      if (!vw) return false;
      const k = Math.max(W / vw, H / vh);
      ctx.drawImage(source, (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    } else {
      ctx.drawImage(source, 0, 0, W, H);
    }
    const px = ctx.getImageData(0, 0, W, H).data;
    this.pixels = px;
    const N = W * H, { luma, cand, mask, labels } = this;

    for (let i = 0, j = 0; i < N; i++, j += 4) luma[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];

    // Screen point → "above horizon", from the camera's up vector (linear in x, y).
    const sx = cam.width / W, sy = cam.height / H;
    const [r, u, b] = cam.cols;
    const above = (x, y) => ((x + 0.5) * sx - cam.width / 2) * r[2] - ((y + 0.5) * sy - cam.height / 2) * u[2] - cam.f * b[2] > 0;

    // 1. Candidates.
    const samples = this.samples;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, j = i * 4;
        const L = luma[i];
        let g = 0;
        if (x > 0) g = Math.max(g, Math.abs(L - luma[i - 1]));
        if (x < W - 1) g = Math.max(g, Math.abs(L - luma[i + 1]));
        if (y > 0) g = Math.max(g, Math.abs(L - luma[i - W]));
        if (y < H - 1) g = Math.max(g, Math.abs(L - luma[i + W]));
        const R = px[j], G = px[j + 1], B = px[j + 2];
        const V = Math.max(R, G, B), sat = V ? (V - Math.min(R, G, B)) / V : 0;
        let c = 0;
        if (g < 22) {
          if (B - R > 10 && B > 90 && B >= G - 10) c = 2;          // blue sky
          else if (V > 200 && sat < 0.2) c = 1;                    // white / grey
          for (const s of samples) {
            if (Math.abs(R - s[0]) + Math.abs(G - s[1]) + Math.abs(B - s[2]) < 45) { c = Math.max(c, 1); break; }
          }
        }
        cand[i] = c;
      }
    }

    // Seeds tapped by the user, mapped to analysis pixels.
    const seedPx = new Set();
    for (const v of this.seeds) {
      const p = cam.project(v);
      if (!p) continue;
      const x = Math.floor(p[0] / sx), y = Math.floor(p[1] / sy);
      if (x >= 0 && y >= 0 && x < W && y < H) seedPx.add(y * W + x);
    }

    // 2. Connected regions (4-neighbour flood fill).
    labels.fill(0);
    mask.fill(0);
    const stack = new Int32Array(N);
    let next = 1;
    const minSize = Math.max(20, N * 0.002);
    for (let s = 0; s < N; s++) {
      if (!cand[s] || labels[s]) continue;
      const id = next++;
      let top = 0, n = 0, nBlue = 0, nAbove = 0, sumV = 0, seeded = false;
      stack[top++] = s; labels[s] = id;
      const members = [];
      while (top) {
        const i = stack[--top];
        members.push(i);
        n++;
        if (cand[i] === 2) nBlue++;
        const x = i % W, y = (i / W) | 0;
        if (above(x, y)) nAbove++;
        sumV += luma[i];
        if (seedPx.has(i)) seeded = true;
        if (x > 0 && cand[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack[top++] = i - 1; }
        if (x < W - 1 && cand[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack[top++] = i + 1; }
        if (y > 0 && cand[i - W] && !labels[i - W]) { labels[i - W] = id; stack[top++] = i - W; }
        if (y < H - 1 && cand[i + W] && !labels[i + W]) { labels[i + W] = id; stack[top++] = i + W; }
      }
      const isSky = seeded || (n >= minSize && nAbove > n * 0.6 &&
        (nBlue > n * 0.05 || sumV / n > 232));
      if (isSky) for (const i of members) mask[i] = 1;
    }

    // Grow the sky over sky-coloured edge pixels (cloud borders fail the smoothness test).
    const skyColour = (j) => {
      const R = px[j], G = px[j + 1], B = px[j + 2];
      const V = Math.max(R, G, B), sat = V ? (V - Math.min(R, G, B)) / V : 0;
      return (B - R > 10 && B > 90 && B >= G - 10) || (V > 190 && sat < 0.25);
    };
    for (let pass = 0; pass < 3; pass++) {
      const grown = mask.slice();
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (mask[i] || !(mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W])) continue;
          if (skyColour(i * 4)) grown[i] = 1;
        }
      }
      mask.set(grown);
    }

    // Close small gaps (sun glare, specks) inside the sky.
    const out = mask.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (mask[i]) continue;
        const k = mask[i - 1] + mask[i + 1] + mask[i - W] + mask[i + W] +
          mask[i - W - 1] + mask[i - W + 1] + mask[i + W - 1] + mask[i + W + 1];
        if (k >= 5) out[i] = 1;
      }
    }
    this.mask = out;
    this.ms = performance.now() - t0;
    this.maskDirty = true;
    return true;
  }

  /** 1 = sky, 0 = obstruction, -1 = outside the analysed frame. Screen CSS pixels. */
  at(cam, x, y) {
    if (!this.mask) return -1;
    const ix = Math.floor((x / cam.width) * this.W), iy = Math.floor((y / cam.height) * this.H);
    const m = 8; // cells slightly off-screen take the nearest edge pixel
    if (ix < -m || iy < -m || ix >= this.W + m || iy >= this.H + m) return -1;
    const cx = Math.min(this.W - 1, Math.max(0, ix)), cy = Math.min(this.H - 1, Math.max(0, iy));
    return this.mask[cy * this.W + cx];
  }

  /** Remember the colour and direction under a tap as sky. */
  teach(cam, x, y) {
    if (!this.pixels) return null;
    const ix = Math.floor((x / cam.width) * this.W), iy = Math.floor((y / cam.height) * this.H);
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = ix + dx, yy = iy + dy;
      if (xx < 0 || yy < 0 || xx >= this.W || yy >= this.H) continue;
      const j = (yy * this.W + xx) * 4;
      r += this.pixels[j]; g += this.pixels[j + 1]; b += this.pixels[j + 2]; n++;
    }
    const c = [r / n, g / n, b / n].map(Math.round);
    this.samples.push(c);
    if (this.samples.length > 6) this.samples.shift();
    this.seeds.push(cam.unproject(x, y));
    if (this.seeds.length > 12) this.seeds.shift();
    return c;
  }

  clearTaught() { this.samples = []; this.seeds = []; }

  /** Mask as a small image: sky tinted cyan, the rest dimmed. */
  maskImage() {
    if (!this.mask) return null;
    if (this.maskDirty) {
      const mctx = this.maskCanvas.getContext('2d');
      const img = mctx.createImageData(this.W, this.H);
      for (let i = 0; i < this.mask.length; i++) {
        const j = i * 4;
        if (this.mask[i]) { img.data[j] = 0; img.data[j + 1] = 230; img.data[j + 2] = 255; img.data[j + 3] = 110; }
        else { img.data[j] = 0; img.data[j + 1] = 0; img.data[j + 2] = 0; img.data[j + 3] = 90; }
      }
      mctx.putImageData(img, 0, 0);
      this.maskDirty = false;
    }
    return this.maskCanvas;
  }
}
