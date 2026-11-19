// "Dây nối điểm" payline style: one textured strip (mesh) per pair of
// neighbouring reel points, hanging with an adjustable sag, plus a light
// overlay per segment and one clipping mask over the whole line. Rebuilt from
// the hand-made reference rig (9687_VFX_Payline):
//   - each segment mesh is weighted to 3 bones: start point, end point and a
//     middle bone pulled down to make the sag (quadratic Bezier weights);
//   - "rung": the middle bone bounces with a decaying wave, each segment a
//     little later than the previous one (a ripple running left to right);
//   - "ánh sáng": the light overlay of each segment fades out in turn;
//   - "mask": a clipping quad opens from left to right, holds, then closes
//     towards the right.
// All coordinates here are Spine's (y up) unless noted.

export const CHAIN_DEFAULTS = {
  sag: 20,            // px the middle of a segment hangs below the straight line (0 = taut)
  overlap: 12,        // px each segment reaches past its end points so links overlap
  meshCols: 9,        // "Số hàng mesh": vertex columns along the strip
  meshRows: 2,        // "Số cột mesh": vertex rows across the strip
  wobbleAmp: 20,      // px the middle of a segment moves on the first bounce
  wobbleDelay: 0.133, // s between segments starting to bounce
  wobbleDur: 0.6,     // s one segment bounces
  lightStart: 0.4,    // s when the first light starts to fade out
  lightDelay: 0.033,  // s between segments' lights
  lightFade: 0.1,     // s a light takes to fade out
  maskIn: 0.5,        // s the mask takes to open (left → right)
  maskHold: 1.0,      // s (from the start) the mask starts closing
  maskOut: 0.5        // s the mask takes to close (towards the right)
};

// Bounce of the middle bone, from the reference: time fractions of wobbleDur
// and displacement fractions of wobbleAmp.
const WOBBLE_T = [0, 0.2222, 0.4444, 0.6667, 0.8333, 1];
const WOBBLE_V = [0, 1, -0.3806, 0.7415, -0.2068, 0];
const EASE = [0.25, 0, 0.75, 1];
const MASK_OPEN_EASE = [0.282, 0, 1, 0.34];

// Straight strip images in up to 3 lengths ("Ngắn / Vừa / Dài"); each segment
// uses the one whose length is closest to the segment's, so links stretch least.
export const CHAIN_SLOTS = ['s1', 's2', 's3'];

const stripLength = (img) => Math.max(img.w, img.h);

// images: { s1: { w, h } | null, ... } → the slot key to use, or null if none.
export function pickStrip(p0, p1, params, images) {
  const need = Math.hypot(p1.x - p0.x, p1.y - p0.y) + 2 * Math.max(0, params.overlap || 0);
  let best = null, bestCost = Infinity;
  for (const k of CHAIN_SLOTS) {
    const img = images[k];
    if (!img) continue;
    const cost = Math.abs(Math.log(need / stripLength(img)));
    if (cost < bestCost) { bestCost = cost; best = k; }
  }
  return best;
}

// Geometry of one segment in its setup pose: a grid of vertices along a
// quadratic Bezier from p0 to p1 that hangs `sag` px in the middle.
// img: { w, h } of the strip (a tall image runs along its height).
// Returns the middle bone position (Bezier control point), the vertices (hull
// first, as Spine wants) with uv and weights for [start, mid, end], triangles.
export function segmentGeometry(p0, p1, img, params) {
  const cols = Math.max(2, Math.round(params.meshCols || 2));
  const rows = Math.max(2, Math.round(params.meshRows || 2));
  const vertical = img.h > img.w;
  // A tall strip is treated as hanging from its top end: attach that end to
  // the higher point (y up). Weights are flipped back to [p0, mid, p1] below.
  const swap = vertical && p0.y < p1.y;
  if (swap) [p0, p1] = [p1, p0];
  const sag = Math.max(0, params.sag || 0);
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const ctrl = { x: mx, y: my - 2 * sag }; // B(0.5) ends up `sag` below the chord
  const thick = vertical ? img.w : img.h;
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const over = Math.max(0, params.overlap || 0);

  const at = (s) => {
    const a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s;
    const x = a * p0.x + b * ctrl.x + c * p1.x;
    const y = a * p0.y + b * ctrl.y + c * p1.y;
    let tx = 2 * (1 - s) * (ctrl.x - p0.x) + 2 * s * (p1.x - ctrl.x);
    let ty = 2 * (1 - s) * (ctrl.y - p0.y) + 2 * s * (p1.y - ctrl.y);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    return { x, y, tx, ty, w: [a, b, c] };
  };

  // grid[r][c]: r across the strip (0 = "top" edge), c along it
  const grid = Array.from({ length: rows }, () => []);
  for (let c = 0; c < cols; c++) {
    const s = c / (cols - 1);
    const p = at(s);
    let { x, y } = p;
    // first/last column reach past the point along the strip ("chồng mép");
    // the image's ends sit exactly on them, so nothing is cut off
    if (c === 0) { x -= p.tx * over; y -= p.ty * over; }
    if (c === cols - 1) { x += p.tx * over; y += p.ty * over; }
    let nx = -p.ty, ny = p.tx; // left of the direction = "up" for a left→right strip
    if (vertical && ny > 0) { nx = -nx; ny = -ny; }
    const along = c === 0 ? 0 : c === cols - 1 ? 1 : (s * len + over) / (len + 2 * over);
    const w = swap ? [p.w[2], p.w[1], p.w[0]] : p.w;
    for (let r = 0; r < rows; r++) {
      const q = r / (rows - 1);
      const off = thick / 2 - q * thick;
      const uv = vertical ? { u: q, v: along } : { u: along, v: q };
      grid[r][c] = { x: x + nx * off, y: y + ny * off, ...uv, w };
    }
  }

  // hull: top row →, right column ↓, bottom row ←, left column ↑; then interior
  const order = [];
  for (let c = 0; c < cols; c++) order.push([0, c]);
  for (let r = 1; r < rows; r++) order.push([r, cols - 1]);
  for (let c = cols - 2; c >= 0; c--) order.push([rows - 1, c]);
  for (let r = rows - 2; r >= 1; r--) order.push([r, 0]);
  const hull = order.length;
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) order.push([r, c]);
  const index = new Map(order.map(([r, c], i) => [`${r},${c}`, i]));
  const verts = order.map(([r, c]) => grid[r][c]);
  const tri = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = index.get(`${r},${c}`), b = index.get(`${r},${c + 1}`);
      const d = index.get(`${r + 1},${c + 1}`), e = index.get(`${r + 1},${c}`);
      tri.push(a, b, d, a, d, e);
    }
  }
  return { ctrl, verts, triangles: tri, hull };
}

// ---- timing ----

export function chainDuration(segCount, params) {
  const wobbleEnd = (segCount - 1) * params.wobbleDelay + params.wobbleDur;
  const lightEnd = params.lightStart + (segCount - 1) * params.lightDelay + params.lightFade;
  const maskEnd = params.maskHold + params.maskOut;
  return Math.max(wobbleEnd, lightEnd, maskEnd, params.maskIn);
}

// Spine-style cubic Bezier easing (x1, y1, x2, y2), for the preview.
function bezierEase(c, t) {
  if (!c) return t;
  const [x1, y1, x2, y2] = c;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 20; i++) {
    s = (lo + hi) / 2;
    const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
    if (x < t) lo = s; else hi = s;
  }
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
}

function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b.t) {
      if (a.curve === 'stepped') return a.v;
      const f = bezierEase(a.curve, (t - a.t) / (b.t - a.t || 1));
      return a.v + (b.v - a.v) * f;
    }
  }
  return keys[keys.length - 1].v;
}

// Keys of the middle bone's displacement (visible px) for segment i.
function wobbleKeys(i, params) {
  const start = i * params.wobbleDelay;
  return WOBBLE_T.map((ft, k) => ({ t: start + ft * params.wobbleDur, v: WOBBLE_V[k] * params.wobbleAmp, curve: EASE }));
}

function lightKeys(i, params) {
  const t0 = params.lightStart + i * params.lightDelay;
  return [{ t: t0, v: 1, curve: EASE }, { t: t0 + params.lightFade, v: 0 }];
}

// Mask edges as fractions of the line's width: [left, right], 0..1.
function maskKeys(params) {
  return {
    right: [{ t: 0, v: 0, curve: MASK_OPEN_EASE }, { t: params.maskIn, v: 1 }],
    left: [{ t: params.maskHold, v: 0, curve: EASE }, { t: params.maskHold + params.maskOut, v: 1 }]
  };
}

// State of the animation at time t, for the in-app preview.
export function chainStateAt(segCount, params, t) {
  const m = maskKeys(params);
  return {
    // the middle bone moves twice the visible amount (its weight there is 0.5)
    mid: Array.from({ length: segCount }, (_, i) => sampleKeys(wobbleKeys(i, params), t)),
    light: Array.from({ length: segCount }, (_, i) => sampleKeys(lightKeys(i, params), t)),
    maskLeft: sampleKeys(m.left, t),
    maskRight: sampleKeys(m.right, t)
  };
}

// ---- Spine 3.7.94 export ----

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const r5 = (n) => Math.round(n * 100000) / 100000;

// patterns: [{ name, points: [{x,y}] in grid px (y down) }]
// images: { s1, s2, s3 } each { region, w, h, light: { region, w, h } | null } or null
// gridCenter / gridSize: grid px; the mask covers the grid plus a margin.
export function buildChainSpineJson({ skeletonName, patterns, images, params, gridCenter, gridSize, margin = 60 }) {
  const toSpine = (p) => ({ x: p.x - gridCenter.x, y: -(p.y - gridCenter.y) });
  const bones = [{ name: 'root' }];
  const slots = [{ name: 'mask', bone: 'root', attachment: 'mask' }];
  const lightSlots = [];
  const skin = {};
  const animations = {};
  const boneIndex = (name) => bones.findIndex((b) => b.name === name);

  const halfW = gridSize.w / 2 + margin, halfH = gridSize.h / 2 + margin;
  const maskVerts = [-halfW, halfH, -halfW, -halfH, halfW, -halfH, halfW, halfH]; // TL, BL, BR, TR
  const maskWidth = halfW * 2;

  patterns.forEach((pat, pi) => {
    const id = `p${pi + 1}`;
    const pts = pat.points.map(toSpine);
    bones.push({ name: `pl_${id}`, parent: 'root' });
    pts.forEach((p, i) => bones.push({ name: `node${i + 1}_${id}`, parent: `pl_${id}`, x: r2(p.x), y: r2(p.y) }));

    const anim = { slots: {}, bones: {}, deform: { default: {} } };
    const segCount = pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const kind = pickStrip(pts[i], pts[i + 1], params, images);
      if (!kind) continue;
      const img = images[kind];
      const geo = segmentGeometry(pts[i], pts[i + 1], img, params);
      const midName = `mid${i + 1}_${id}`;
      bones.push({ name: midName, parent: `pl_${id}`, x: r2(geo.ctrl.x), y: r2(geo.ctrl.y) });
      const segBones = [`node${i + 1}_${id}`, midName, `node${i + 2}_${id}`];
      const bonePos = [pts[i], geo.ctrl, pts[i + 1]];

      const encode = (geo) => {
        const out = [];
        geo.verts.forEach((v) => {
          const used = v.w.map((w, k) => ({ w, k })).filter((o) => o.w > 1e-6);
          out.push(used.length);
          used.forEach(({ w, k }) => {
            out.push(boneIndex(segBones[k]), r2(v.x - bonePos[k].x), r2(v.y - bonePos[k].y), r5(w));
          });
        });
        return out;
      };
      // the light has its own thickness, so its own geometry on the same bones
      const mesh = (geo, region, w, h) => {
        const edges = [];
        for (let e = 0; e < geo.hull; e++) edges.push(e * 2, ((e + 1) % geo.hull) * 2);
        return {
          type: 'mesh', path: region,
          uvs: geo.verts.flatMap((v) => [r4(v.u), r4(v.v)]),
          triangles: geo.triangles, vertices: encode(geo), hull: geo.hull, edges, width: w, height: h
        };
      };

      const segSlot = `seg${i + 1}_${id}`;
      slots.push({ name: segSlot, bone: `pl_${id}` });
      skin[segSlot] = { [img.region]: mesh(geo, img.region, img.w, img.h) };
      anim.slots[segSlot] = { attachment: [{ time: 0, name: img.region }] };

      if (img.light) {
        const lSlot = `light${i + 1}_${id}`;
        lightSlots.push({ name: lSlot, bone: `pl_${id}` });
        const lgeo = segmentGeometry(pts[i], pts[i + 1], img.light, params);
        skin[lSlot] = { [img.light.region]: mesh(lgeo, img.light.region, img.light.w, img.light.h) };
        const lk = lightKeys(i, params);
        anim.slots[lSlot] = {
          attachment: [{ time: 0, name: img.light.region }],
          color: [
            { time: r4(lk[0].t), color: 'ffffffff', curve: EASE },
            { time: r4(lk[1].t), color: 'ffffff00' }
          ]
        };
      }

      // middle bone bounce: twice the visible amount (its weight mid-strip is 0.5)
      anim.bones[midName] = {
        translate: wobbleKeys(i, params).map((k, j, arr) => ({
          time: r4(k.t), x: 0, y: r2(2 * k.v), ...(j < arr.length - 1 ? { curve: EASE } : {})
        }))
      };
    }

    // mask: right edge opens from the left, later the left edge closes to the right
    const m = maskKeys(params);
    const shift = (left, right) => [left, 0, left, 0, right, 0, right, 0].map(r2);
    anim.deform.default.mask = {
      mask: [
        { time: 0, vertices: shift(0, -maskWidth), curve: MASK_OPEN_EASE },
        { time: r4(m.right[1].t), vertices: shift(0, 0), curve: 'stepped' },
        { time: r4(m.left[0].t), vertices: shift(0, 0), curve: EASE },
        { time: r4(m.left[1].t), vertices: shift(maskWidth, 0) }
      ]
    };
    animations[pat.name] = anim;
  });

  // lights above all strips; the mask clips everything up to the last slot
  slots.push(...lightSlots);
  const last = slots[slots.length - 1].name;
  skin.mask = { mask: { type: 'clipping', end: last, vertexCount: 4, vertices: maskVerts.map(r2), color: 'ce3a3aff' } };

  return {
    skeleton: { hash: hashOf(skeletonName), spine: '3.7.94', width: r2(maskWidth), height: r2(halfH * 2), images: './images/', audio: '' },
    bones,
    slots,
    skins: { default: skin },
    animations
  };
}

function hashOf(seed) {
  let h = 0;
  const s = `${seed}-${Date.now()}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
