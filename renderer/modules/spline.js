// Catmull-Rom-style spline through control points, with adjustable
// tension, a per-point tangent that can be manually overridden by the
// user (Bezier-style handles the UI lets them drag), virtual overshoot
// points at both ends for natural boundary tangents, and even
// arc-length resampling.

export function computeTangents(points) {
  // Central-difference tangent angle (radians) at each point, for
  // rotating hose-rig control bones so mesh thickness follows the
  // curve instead of staying fixed to the original horizontal axis.
  const n = points.length;
  const angles = [];
  for (let i = 0; i < n; i++) {
    let a, b;
    if (i === 0) { a = points[0]; b = points[Math.min(1, n - 1)]; }
    else if (i === n - 1) { a = points[n - 2]; b = points[n - 1]; }
    else { a = points[i - 1]; b = points[i + 1]; }
    angles.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  return angles;
}

// Auto tangent vector AT `curr`, for the Hermite segment(s) touching it.
//
// The naive formula uses the raw chord (next - prev) as the tangent,
// with no regard for how long each side actually is. That's the
// classic Catmull-Rom overshoot trap: if `curr` sits at the end of a
// short hop (e.g. one grid cell over, same row) but the *next* leg is
// a long diagonal to another reel, the chord direction gets dragged
// almost entirely onto the long leg's heading — so the short segment
// swings into a wide, unwanted arc/loop instead of reading as a
// straight line.
//
// Fix: (1) average the two adjacent segments' *unit* directions instead
// of their raw vectors, so a much-longer neighboring segment can't out-
// vote a short one on direction, and (2) cap the tangent's magnitude to
// the length of the SHORTER adjacent segment, so it can never reach
// further than that segment itself. This keeps short "adjacent-cell"
// hops reading as close to straight, only mildly bent toward a turn,
// while longer legs still get a full, smooth curve. It is only an
// automatic default though — a point sitting exactly at a turn between
// a flat run and a diagonal leg will still show a little curvature by
// construction (a smoothly-blended tangent can't be exactly parallel to
// both adjacent segments at once when they point in different
// directions). Use the manual tangent handles (see getEffectiveTangents)
// to flatten a specific segment completely.
export function computeTangentVector(prev, curr, next) {
  const dPrevX = curr.x - prev.x, dPrevY = curr.y - prev.y;
  const dNextX = next.x - curr.x, dNextY = next.y - curr.y;
  const lenPrev = Math.hypot(dPrevX, dPrevY) || 1e-6;
  const lenNext = Math.hypot(dNextX, dNextY) || 1e-6;

  let dirX = dPrevX / lenPrev + dNextX / lenNext;
  let dirY = dPrevY / lenPrev + dNextY / lenNext;
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen > 1e-6) {
    dirX /= dirLen; dirY /= dirLen;
  } else {
    // incoming/outgoing directions cancel out (a sharp reversal) — fall
    // back to the outgoing direction rather than a zero vector
    dirX = dNextX / lenNext; dirY = dNextY / lenNext;
  }

  const mag = Math.min(lenPrev, lenNext);
  return { x: dirX * mag, y: dirY * mag };
}

function extendEnd(points, overshootRatio = 0.6) {
  // Add virtual points before first / after last so the curve has a
  // natural tangent going in/out at the boundary.
  if (points.length < 2) return points.slice();
  const first = points[0];
  const second = points[1];
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];

  const preX = first.x - (second.x - first.x) * overshootRatio;
  const preY = first.y - (second.y - first.y) * overshootRatio;
  const postX = last.x + (last.x - secondLast.x) * overshootRatio;
  const postY = last.y + (last.y - secondLast.y) * overshootRatio;

  return [{ x: preX, y: preY }, ...points, { x: postX, y: postY }];
}

// One auto tangent vector per REAL control point (not the virtual
// boundary points), using the extended [virtualPre, ...points, virtualPost]
// array so the first/last real points get a sensible boundary tangent too.
// Returned array is index-aligned with `points`.
export function computeAutoTangents(points) {
  if (points.length < 2) return points.map(() => ({ x: 0, y: 0 }));
  const ext = extendEnd(points);
  const tangents = [];
  for (let i = 1; i < ext.length - 1; i++) {
    tangents.push(computeTangentVector(ext[i - 1], ext[i], ext[i + 1]));
  }
  return tangents;
}

// Per-point tangent HANDLE vectors — `{ fwd, bwd }` — substituting a
// user override wherever present.
//
// `tangentOverrides` is a sparse array, index-aligned with `points`.
// Each entry is either null/undefined (fully auto — both sides track
// the auto-computed tangent, "smooth point" style), or `{ angle,
// lenFwd, lenBwd }`:
//   - `angle` (radians) is the ONE shared direction of the tangent
//     LINE through the point — fwd points along `angle`, bwd points
//     along `angle + π`. The handle is always a single straight line
//     through its anchor point; there is no "broken corner" mode,
//     because letting the two sides point in independent, freely-
//     dragged directions made the handle look disconnected from its
//     own anchor while dragging ("bay ra khỏi điểm neo").
//   - `lenFwd` / `lenBwd` are independent lengths for each side, so
//     one arm can be short/straight while the other still pulls the
//     curve — the actually-useful part of a "corner" handle, without
//     the disorienting free angle.
// `fwd` is the tangent used as this point's OUTGOING tangent (feeds
// the segment toward the next point); `bwd` is used as this point's
// INCOMING tangent (feeds the segment coming from the previous point).
// With no override, fwd and bwd are identical (auto), so this behaves
// exactly like the single shared tangent buildCurve() used originally.
//
// IMPORTANT sign convention: both `fwd` AND `bwd` point "forward along
// the curve" (the same direction sense buildCurve()/hermite() need for
// m1/m2 — this is why the auto case can share one vector for both).
// `bwd` is NOT the on-screen vector from the anchor to its visual grip
// (that grip sits on the opposite side, at `angle + π`) — callers that
// draw or hit-test the grip must negate it themselves (`p - bwd`), the
// same way they already did for the plain-auto vector. Returning `bwd`
// pre-negated here once broke exactly that: it fed a backward-pointing
// tangent into buildCurve's Hermite math AND made the on-screen handle
// collapse onto its `fwd` side (both ends landing on the same point)
// the instant a real override was set, making the handle line vanish
// as soon as it was dragged.
export function getHandleVectors(points, tangentOverrides) {
  const auto = computeAutoTangents(points);
  return auto.map((v, i) => {
    const ov = tangentOverrides && tangentOverrides[i];
    // Guard against a malformed/legacy override (e.g. an old {fwd,bwd}
    // vector-pair shape from before the shared-angle redesign, or any
    // object missing a finite angle/length) — fall back to the fully
    // auto handle instead of silently producing NaN and rendering a
    // broken/one-sided handle.
    const valid = ov &&
      Number.isFinite(ov.angle) &&
      Number.isFinite(ov.lenFwd) &&
      Number.isFinite(ov.lenBwd);
    if (!valid) return { fwd: v, bwd: v };
    const cos = Math.cos(ov.angle), sin = Math.sin(ov.angle);
    return {
      fwd: { x: cos * ov.lenFwd, y: sin * ov.lenFwd },
      bwd: { x: cos * ov.lenBwd, y: sin * ov.lenBwd }
    };
  });
}

// Backward-compatible single-vector view (used to always equal both
// sides pre-corner-handles). Kept for any external caller that only
// wants "the" tangent at a point; buildCurve() now uses
// getHandleVectors() directly so it can tell fwd/bwd apart.
export function getEffectiveTangents(points, tangentOverrides) {
  return getHandleVectors(points, tangentOverrides).map((h) => h.fwd);
}

// Cubic Hermite evaluation between p1 and p2 given explicit tangent
// vectors at each end (direction + magnitude already baked in —
// `tension` only scales how strongly they pull the curve off the
// straight chord between p1 and p2; tension=1 collapses to an exact
// straight line regardless of the tangents).
export function hermite(p1, p2, m1, m2, t, tension) {
  const s = 1 - tension;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return {
    x: h00 * p1.x + h10 * s * m1.x + h01 * p2.x + h11 * s * m2.x,
    y: h00 * p1.y + h10 * s * m1.y + h01 * p2.y + h11 * s * m2.y
  };
}

// Kept for backward compatibility with the original 4-point signature.
// buildCurve() no longer calls this internally — it precomputes one
// tangent per point up front instead (via getEffectiveTangents), so a
// manual override and the shared boundary tangent stay consistent
// between the two segments touching each point.
export function catmullRom(p0, p1, p2, p3, t, tension) {
  const m1 = computeTangentVector(p0, p1, p2);
  const m2 = computeTangentVector(p1, p2, p3);
  return hermite(p1, p2, m1, m2, t, tension);
}

// Straight lead-in / lead-out segments at the SAME HEIGHT (y) as the
// first/last control point — a flat line running off the grid to the
// left before the first reel, and off the grid to the right after the
// last reel. This is purely a straight-line extension for
// drawing/exporting the ends; it intentionally does NOT add extra
// samples into buildCurve()'s output, so bone count / rig timing stay
// exactly as configured.
//
// `extendLength` is an absolute distance in the same units as `points`
// (grid pixel space) — pass something tied to cell size (e.g. ~1x cell
// width) so it reliably clears the grid's edge.
export function computeLeadExtensions(points, extendLength) {
  if (!points || points.length < 1 || !extendLength) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    leadIn: { x: first.x - extendLength, y: first.y },
    leadOut: { x: last.x + extendLength, y: last.y }
  };
}

// Find the (x,y) at a given arc-length position along a dense polyline,
// using its cumulative-length table `cum` (same length as `dense`).
function pointAtArcLength(dense, cum, target) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1; else hi = mid;
  }
  const idx = Math.max(1, lo);
  const segLen = cum[idx] - cum[idx - 1] || 1;
  const frac = (target - cum[idx - 1]) / segLen;
  const a = dense[idx - 1], b = dense[idx];
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

// Build a dense polyline approximation of the smooth curve through `points`
// (one point per reel), then resample it into `sampleCount` samples.
//
// Every original control point (reel center) is always included exactly
// (both coordinates copied verbatim, not re-interpolated), so a bone always
// lands precisely on each reel's cell center — this avoids the curve
// visually "cutting the corner" at sharp turns just because arc-length
// resampling happened not to land a sample exactly on the control point.
// Any remaining sample budget is distributed across the segments between
// consecutive control points, proportional to each segment's arc length,
// and spaced evenly by arc length within the segment.
//
// `tangentOverrides` (optional): sparse array index-aligned with
// `points` — see getHandleVectors(). Passing the same pattern's
// overrides here (grid overlay, mesh preview, AND Spine export all call
// buildCurve with the same arguments) is what makes a manually-dragged
// tangent handle affect the final exported animation too.
//
// Returns { samples, maxTurnAngle }
export function buildCurve(points, tension, sampleCount, tangentOverrides) {
  const n = points.length;
  if (n < 2) {
    return { samples: points.map((p) => ({ x: p.x, y: p.y })), maxTurnAngle: 0 };
  }
  // never fewer samples than control points — every reel center needs a bone
  sampleCount = Math.max(sampleCount, n);

  const handles = getHandleVectors(points, tangentOverrides);

  const dense = [];
  const segStepsPerPair = 24;
  // dense index where control point k lands exactly (t=0 of its pair).
  const controlDenseIdx = [];

  for (let i = 0; i < n - 1; i++) {
    controlDenseIdx.push(dense.length);
    const p1 = points[i], p2 = points[i + 1];
    // leaving p1 uses its OUTGOING (fwd) handle; arriving at p2 uses
    // its INCOMING (bwd) handle — same value as fwd unless the user
    // Shift-dragged that point into an asymmetric "corner" handle
    const m1 = handles[i].fwd, m2 = handles[i + 1].bwd;
    for (let s = 0; s < segStepsPerPair; s++) {
      const t = s / segStepsPerPair;
      dense.push(hermite(p1, p2, m1, m2, t, tension));
    }
  }
  dense.push({ x: points[n - 1].x, y: points[n - 1].y });
  controlDenseIdx.push(dense.length - 1); // last control point

  // arc length table
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i].x - dense[i - 1].x;
    const dy = dense[i].y - dense[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }

  // arc-length position of each control point (reel center) — controlDenseIdx
  // now has exactly n entries, one per control point, in order
  const controlArc = controlDenseIdx.map((idx) => cum[idx]);

  // distribute (sampleCount - n) extra samples across the n-1 segments,
  // proportional to each segment's arc length (largest-remainder method)
  const extra = sampleCount - n;
  const segLens = [];
  for (let i = 0; i < n - 1; i++) segLens.push(Math.max(0, controlArc[i + 1] - controlArc[i]));
  const totalLen = segLens.reduce((a, b) => a + b, 0) || 1;

  const rawCounts = segLens.map((len) => (extra * len) / totalLen);
  const segExtra = rawCounts.map(Math.floor);
  let assigned = segExtra.reduce((a, b) => a + b, 0);
  const remainders = rawCounts.map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r);
  for (let k = 0; k < remainders.length && assigned < extra; k++, assigned++) {
    segExtra[remainders[k].i]++;
  }

  const samples = [];
  for (let i = 0; i < n - 1; i++) {
    samples.push({ x: points[i].x, y: points[i].y }); // exact control point
    const m = segExtra[i];
    for (let j = 1; j <= m; j++) {
      const target = controlArc[i] + (segLens[i] * j) / (m + 1);
      samples.push(pointAtArcLength(dense, cum, target));
    }
  }
  samples.push({ x: points[n - 1].x, y: points[n - 1].y }); // final exact control point

  // turn-angle analysis (using the original control points, not dense samples,
  // to warn about genuinely sharp reel-to-reel turns)
  let maxTurnAngle = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const len1 = Math.hypot(v1.x, v1.y) || 1;
    const len2 = Math.hypot(v2.x, v2.y) || 1;
    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
    if (angle > maxTurnAngle) maxTurnAngle = angle;
  }

  return { samples, maxTurnAngle };
}
