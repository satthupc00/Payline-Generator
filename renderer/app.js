import { buildGridLayout } from './modules/grid.js';
import { buildCurve, buildRigSamples, computeTangents, getHandleVectors, computeAutoTangents } from './modules/spline.js';
import { buildRibbonMesh, skinVertices } from './modules/mesh.js';
import { packFrames, buildAtlasText, pageFileName } from './modules/atlasPacker.js';
import { buildSpineJson } from './modules/spineExport.js';

// ---------------- state ----------------
const MIN_BONE_COUNT = 8, MAX_BONE_COUNT = 200, DEFAULT_BONE_COUNT = 24;

// Snap a bone-count request up to the nearest multiple of the reel/column
// count, with a floor of one bone per reel — this guarantees a bone always
// lands on every reel's cell center (see spline.js buildCurve), which is
// what removes the "gãy" kinks that showed up with plain arc-length spacing.
function snapBoneCountToReels(n, reels) {
  reels = Math.max(1, reels);
  const k = Math.max(1, Math.ceil(n / reels));
  return k * reels;
}

function effectiveBoneCount() {
  const reels = state.gridConfig.reels;
  let n;
  if (!state.boneAuto) {
    n = state.boneCount;
  } else {
    // scale bone count with the sharpest turn seen across all patterns,
    // so users don't have to guess a manual value
    let maxAngle = 0;
    state.patterns.forEach((p) => {
      const pts = patternPoints(p);
      if (!pts) return;
      const { maxTurnAngle } = buildCurve(pts, p.tension / 100, DEFAULT_BONE_COUNT, p.tangentOverrides);
      if (maxTurnAngle > maxAngle) maxAngle = maxTurnAngle;
    });
    const auto = Math.round(DEFAULT_BONE_COUNT * (1 + maxAngle / 90));
    n = Math.max(MIN_BONE_COUNT, Math.min(MAX_BONE_COUNT, auto));
  }
  return snapBoneCountToReels(n, reels);
}

// Straight lead-in / lead-out lines at both ends of the payline, each ending
// in an end bone. Their length is set per side in Grid config, from 0 (end
// bone sits on the first/last reel point) up to one cell size (the default).
const END_BONES = 2;
function maxLeadLength(cfg = state.gridConfig) {
  return Math.max(cfg.cellW, cfg.cellH);
}
function clampLead(v, cfg) {
  const max = maxLeadLength(cfg);
  if (v == null || !Number.isFinite(Number(v))) return max;
  return Math.max(0, Math.min(max, Number(v)));
}
function leadLengths() {
  return { leadIn: clampLead(state.gridConfig.leadIn), leadOut: clampLead(state.gridConfig.leadOut) };
}
function rigSamples(pattern, pts, curveBones) {
  const { leadIn, leadOut } = leadLengths();
  return buildRigSamples(pts, pattern.tension / 100, curveBones, pattern.tangentOverrides, leadIn, leadOut);
}

const state = {
  gridConfig: {
    reels: 5,
    rowsPerReel: [4, 4, 4, 4, 4],
    cellW: 90, cellH: 90, gap: 6,
    gridType: 'straight',
    staggerOffset: 20,
    strokeColor: '#4a2f7a',
    leadIn: null,   // px; null = max (one cell size)
    leadOut: null
  },
  patterns: [],       // { id, name, points: [rowIndex per reel] (or null), tension, warn }
  activePatternId: null,
  flipbook: [],        // { name, img }
  skeletonName: 'PayLine_Skeleton',
  bgImage: null,       // { img, x, y, scale, locked }
  bgEditing: false,
  bgBrightness: 0,
  bgOpacity: 100,
  bgVisible: true,
  density: 40,
  gridRows: 2,
  boneAuto: false,
  boneCount: DEFAULT_BONE_COUNT,
  baseName: 'VFX_Playline',
  outputPath: '',
  presets: {},
  playing: false,
  scrubIndex: 0,
  mesh: null,
  previewZoom: 1,
  previewPan: { x: 0, y: 0 },
  showMeshWire: false,
  meshOpacity: 70,
  showBones: false,
  trimAtlas: true,
  warnAngleThreshold: 55
};

let uidCounter = 1;
const uid = () => `pat_${uidCounter++}`;

// live rubber-band selection rectangle while dragging on empty grid
// space ({x0,y0,x1,y1} in grid-layout space), null when not dragging
let dragSelectRect = null;

// ---------------- DOM refs ----------------
const el = (id) => document.getElementById(id);
const gridCanvas = el('gridCanvas');
const gridStage = el('gridStage');
const previewCanvas = el('previewCanvas');
const patternListEl = el('patternList');

// ==================================================================
// Pattern helpers
// ==================================================================
function activePattern() {
  return state.patterns.find((p) => p.id === state.activePatternId) || null;
}

function patternPoints(pattern) {
  // convert rowIndex-per-reel into pixel centers using current grid layout
  const layout = buildGridLayout(state.gridConfig);
  const pts = [];
  for (let r = 0; r < state.gridConfig.reels; r++) {
    const rowIdx = pattern.points[r];
    const col = layout.columns[r];
    if (rowIdx == null || !col[rowIdx]) return null;
    pts.push({ x: col[rowIdx].cx, y: col[rowIdx].cy });
  }
  return pts;
}

function recomputeWarning(pattern) {
  const pts = patternPoints(pattern);
  if (!pts) { pattern.warn = false; return; }
  const { maxTurnAngle } = buildCurve(pts, pattern.tension / 100, effectiveBoneCount(), pattern.tangentOverrides);
  pattern.warn = maxTurnAngle > state.warnAngleThreshold;
  pattern.maxTurnAngle = maxTurnAngle;
}

function addPattern(clonedFrom) {
  const n = state.patterns.length + 1;
  const p = clonedFrom
    ? { ...clonedFrom, id: uid(), name: `${state.baseName}_${String(n).padStart(2, '0')}`, points: [...clonedFrom.points], tangentOverrides: [...(clonedFrom.tangentOverrides || [])], selectedReels: [] }
    : { id: uid(), name: `${state.baseName}_${String(n).padStart(2, '0')}`, points: new Array(state.gridConfig.reels).fill(null), tangentOverrides: new Array(state.gridConfig.reels).fill(null), selectedReels: [], tension: 55 };
  state.patterns.push(p);
  state.activePatternId = p.id;
  renumberPatterns();
  renderAll();
}

function renumberPatterns() {
  state.patterns.forEach((p, i) => {
    if (!p.customNamed) p.name = `${state.baseName}_${String(i + 1).padStart(2, '0')}`;
  });
}

function deletePattern(id) {
  state.patterns = state.patterns.filter((p) => p.id !== id);
  if (state.activePatternId === id) {
    state.activePatternId = state.patterns.length ? state.patterns[0].id : null;
  }
  renumberPatterns();
  renderAll();
}

// ==================================================================
// Grid canvas rendering
// ==================================================================
function fitCanvasToStage(canvas, stage) {
  const rect = stage.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  return rect;
}

function drawGrid() {
  const rect = fitCanvasToStage(gridCanvas, gridStage);
  const ctx = gridCanvas.getContext('2d');
  ctx.clearRect(0, 0, rect.width, rect.height);

  const layout = buildGridLayout(state.gridConfig);
  const offX = (rect.width - layout.totalW) / 2;
  const offY = (rect.height - layout.totalH) / 2;

  ctx.save();
  ctx.translate(offX, offY);

  // background reference image
  if (state.bgImage && state.bgVisible) {
    const bg = state.bgImage;
    ctx.save();
    ctx.globalAlpha = (state.bgOpacity ?? 100) / 100;
    const pct = 100 + (state.bgBrightness || 0);
    ctx.filter = `brightness(${Math.max(0, pct)}%)`;
    const w = bg.img.naturalWidth * bg.scale;
    const h = bg.img.naturalHeight * bg.scale;
    ctx.drawImage(bg.img, bg.x, bg.y, w, h);
    ctx.filter = 'none';
    ctx.restore();
    if (state.bgEditing) {
      ctx.strokeStyle = '#35e4f5';
      ctx.lineWidth = 1;
      ctx.strokeRect(bg.x, bg.y, w, h);
    }
  }

  // grid cells
  layout.columns.forEach((col, r) => {
    col.forEach((cell) => {
      ctx.fillStyle = 'rgba(42,26,74,0.55)';
      ctx.strokeStyle = state.gridConfig.strokeColor || '#4a2f7a';
      ctx.lineWidth = 1;
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 6);
      ctx.fill();
      ctx.stroke();
    });
  });

  // active pattern selection highlight + curve overlay
  const pattern = activePattern();
  if (pattern) {
    layout.columns.forEach((col, r) => {
      const rowIdx = pattern.points[r];
      if (rowIdx != null && col[rowIdx]) {
        const cell = col[rowIdx];
        ctx.strokeStyle = '#ff4fa3';
        ctx.lineWidth = 2;
        roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 6);
        ctx.stroke();
      }
    });

    const pts = patternPoints(pattern);
    if (pts) {
      if (!pattern.tangentOverrides || pattern.tangentOverrides.length !== pts.length) {
        pattern.tangentOverrides = new Array(pts.length).fill(null);
      }
      const { samples, maxTurnAngle } = buildCurve(pts, pattern.tension / 100, effectiveBoneCount(), pattern.tangentOverrides);
      pattern.warn = maxTurnAngle > state.warnAngleThreshold;
      pattern.maxTurnAngle = maxTurnAngle;
      ctx.strokeStyle = pattern.warn ? '#ffcc33' : '#35e4f5';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = pattern.warn ? 'rgba(255,204,51,.6)' : 'rgba(53,228,245,.6)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      samples.forEach((s, i) => (i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y)));
      ctx.stroke();

      // straight lead-in / lead-out, flat at the same height (y) as the
      // first/last reel point, ending in the end bones — same neon style
      // as the curve; length per side comes from Grid config
      const { leadIn, leadOut } = leadLengths();
      const endIn = { x: pts[0].x - leadIn, y: pts[0].y };
      const endOut = { x: pts[pts.length - 1].x + leadOut, y: pts[pts.length - 1].y };
      ctx.beginPath();
      ctx.moveTo(endIn.x, endIn.y);
      ctx.lineTo(pts[0].x, pts[0].y);
      ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.lineTo(endOut.x, endOut.y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // end bones: hollow rings so they read differently from reel points
      ctx.strokeStyle = pattern.warn ? '#ffcc33' : '#35e4f5';
      ctx.lineWidth = 1.5;
      [endIn, endOut].forEach((b) => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2);
        ctx.stroke();
      });

      const selected = pattern.selectedReels || [];
      pts.forEach((p, i) => {
        const isSel = selected.includes(i);
        ctx.fillStyle = pattern.warn ? '#ffcc33' : '#ff4fa3';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (isSel) {
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // draggable tangent handles — a short line through each SELECTED
      // control point, both ends grab-able, so the user can manually
      // override the auto-computed tangent (e.g. to force a flat run
      // dead straight). Plain drag moves both ends (symmetric "smooth
      // point"); Shift+drag moves only the grabbed side, leaving the
      // other side alone ("corner" handle — see getHandleVectors in
      // spline.js). Double-click a handle to reset it to auto (Shift +
      // double-click resets just that one side).
      //
      // Click a point's dot to select it (shows its handle); Ctrl/Cmd
      // click a dot to add/remove it from the selection; drag a
      // rectangle over empty space to select every dot inside it
      // (Ctrl/Cmd held = add to the current selection); click empty
      // space (no drag) to clear the selection.
      if (selected.length) {
        const handles = getHandleVectors(pts, pattern.tangentOverrides);
        ctx.strokeStyle = '#4ade80';
        ctx.fillStyle = '#4ade80';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 0;
        selected.forEach((i) => {
          const p = pts[i];
          const { fwd, bwd } = handles[i];
          const a = { x: p.x - bwd.x, y: p.y - bwd.y };
          const b = { x: p.x + fwd.x, y: p.y + fwd.y };
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          [a, b].forEach((h) => {
            ctx.beginPath();
            ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          });
        });
      }
    }
  }

  // live rubber-band selection rectangle, drawn in grid-layout space
  // (inside the same ctx.translate as everything else above)
  if (dragSelectRect) {
    ctx.strokeStyle = '#4ade80';
    ctx.fillStyle = 'rgba(74,222,128,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const { x0, y0, x1, y1 } = dragSelectRect;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  }

  ctx.restore();
  updateWarningBox(pattern);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function updateWarningBox(pattern) {
  const box = el('warningBox');
  if (pattern && pattern.warn) {
    box.style.display = 'flex';
    el('warningText').textContent = `Khúc cong quá gắt (~${Math.round(pattern.maxTurnAngle)}°) — mesh có thể bị chồng/xoắn ở "${pattern.name}".`;
  } else {
    box.style.display = 'none';
  }
}

function gridClickToCell(mx, my) {
  const rect = gridCanvas.getBoundingClientRect();
  const layout = buildGridLayout(state.gridConfig);
  const offX = (rect.width - layout.totalW) / 2;
  const offY = (rect.height - layout.totalH) / 2;
  const x = mx - offX, y = my - offY;

  let bestReel = -1, bestRow = -1, bestDist = Infinity;
  layout.columns.forEach((col, r) => {
    col.forEach((cell, row) => {
      if (x >= cell.x - 4 && x <= cell.x + cell.w + 4 && y >= cell.y - 4 && y <= cell.y + cell.h + 4) {
        const d = Math.hypot(x - cell.cx, y - cell.cy);
        if (d < bestDist) { bestDist = d; bestReel = r; bestRow = row; }
      }
    });
  });
  return bestReel >= 0 ? { reel: bestReel, row: bestRow } : null;
}

const TANGENT_HANDLE_HIT_RADIUS = 8;

// Hit-test the active pattern's tangent handle endpoints — only points
// currently in `pattern.selectedReels` have a visible/interactive
// handle. (gx, gy) must already be in grid-layout space (i.e. canvas
// coords minus the centering offset drawGrid() applies via
// ctx.translate).
function hitTestTangentHandle(gx, gy) {
  const pattern = activePattern();
  if (!pattern) return null;
  const selected = pattern.selectedReels || [];
  if (!selected.length) return null;
  const pts = patternPoints(pattern);
  if (!pts) return null;
  const handles = getHandleVectors(pts, pattern.tangentOverrides);
  for (const i of selected) {
    const p = pts[i];
    const { fwd, bwd } = handles[i];
    const fwdEnd = { x: p.x + fwd.x, y: p.y + fwd.y };
    const bwdEnd = { x: p.x - bwd.x, y: p.y - bwd.y };
    if (Math.hypot(gx - fwdEnd.x, gy - fwdEnd.y) <= TANGENT_HANDLE_HIT_RADIUS) return { reel: i, end: 'fwd', point: p };
    if (Math.hypot(gx - bwdEnd.x, gy - bwdEnd.y) <= TANGENT_HANDLE_HIT_RADIUS) return { reel: i, end: 'bwd', point: p };
  }
  return null;
}

const POINT_DOT_HIT_RADIUS = 9;

// Hit-test the active pattern's placed point DOTS (not the tangent
// handles) — used to select a point (revealing its tangent handle),
// independent of whether it's already selected.
function hitTestPointDot(pattern, gx, gy) {
  const pts = patternPoints(pattern);
  if (!pts) return null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (Math.hypot(gx - p.x, gy - p.y) <= POINT_DOT_HIT_RADIUS) return i;
  }
  return null;
}

function setSelectedReels(pattern, reelIndices) {
  pattern.selectedReels = [...new Set(reelIndices)];
}
function toggleSelectedReel(pattern, i) {
  const sel = pattern.selectedReels || (pattern.selectedReels = []);
  const idx = sel.indexOf(i);
  if (idx >= 0) sel.splice(idx, 1); else sel.push(i);
}

function gridSpaceOffset() {
  const rect = gridCanvas.getBoundingClientRect();
  const layout = buildGridLayout(state.gridConfig);
  return { offX: (rect.width - layout.totalW) / 2, offY: (rect.height - layout.totalH) / 2, rect };
}

gridCanvas.addEventListener('mousedown', (e) => {
  const rectBounds = gridCanvas.getBoundingClientRect();
  const mx = e.clientX - rectBounds.left, my = e.clientY - rectBounds.top;

  if (state.bgEditing && state.bgImage) {
    const bg = state.bgImage;
    const startX = e.clientX, startY = e.clientY;
    const origX = bg.x, origY = bg.y;
    const onMove = (ev) => {
      bg.x = origX + (ev.clientX - startX);
      bg.y = origY + (ev.clientY - startY);
      drawGrid();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return;
  }

  const { offX, offY } = gridSpaceOffset();
  const gx = mx - offX, gy = my - offY;

  // 1) tangent-handle drag (only for currently-selected points) takes
  // priority over everything else below
  const handleHit = hitTestTangentHandle(gx, gy);
  if (handleHit) {
    const pattern = activePattern();
    const reel = handleHit.reel, end = handleHit.end, anchor = handleHit.point;

    // decide symmetric-vs-independent ONCE for the whole drag gesture
    // (re-checking ev.shiftKey on every mousemove risked the modifier
    // key state blipping mid-drag and silently flipping mode for just
    // that one frame)
    const asymmetric = e.shiftKey;

    if (!asymmetric) {
      // Plain drag: point the whole handle line straight at the mouse,
      // both sides equal length and mirrored through the anchor — the
      // handle always looks like one coherent line through its point.
      const onMove = (ev) => {
        const r2 = gridCanvas.getBoundingClientRect();
        const mgx = ev.clientX - r2.left - offX;
        const mgy = ev.clientY - r2.top - offY;
        let vx = mgx - anchor.x, vy = mgy - anchor.y;
        if (end === 'bwd') { vx = -vx; vy = -vy; }
        const angle = Math.atan2(vy, vx);
        const len = Math.hypot(vx, vy);
        pattern.tangentOverrides[reel] = { angle, lenFwd: len, lenBwd: len };
        drawGrid();
        drawPreview();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    } else {
      // Shift-drag: the handle stays a single straight line through the
      // anchor at all times (never flies off at some arbitrary angle) —
      // dragging left/right (along the handle's current direction)
      // changes ONLY this side's length; dragging up/down
      // (perpendicular to it) rotates BOTH sides together. Everything
      // is measured against the ORIGINAL direction/lengths captured
      // once at mousedown, so the effect only depends on total mouse
      // movement, never on values written during the drag itself.
      const pts = patternPoints(pattern);
      const existing = pattern.tangentOverrides[reel];
      let angle0, lenFwd0, lenBwd0;
      if (existing) {
        angle0 = existing.angle; lenFwd0 = existing.lenFwd; lenBwd0 = existing.lenBwd;
      } else {
        const autoV = computeAutoTangents(pts)[reel];
        angle0 = Math.atan2(autoV.y, autoV.x);
        lenFwd0 = lenBwd0 = Math.hypot(autoV.x, autoV.y);
      }
      const alongX = Math.cos(angle0), alongY = Math.sin(angle0);
      const perpX = -Math.sin(angle0), perpY = Math.cos(angle0);
      const ROTATE_SENSITIVITY = Math.PI / 2 / 200; // ~200px of perpendicular drag = 90°
      const MIN_LEN = 0;

      const onMove = (ev) => {
        const r2 = gridCanvas.getBoundingClientRect();
        const curGX = ev.clientX - r2.left - offX;
        const curGY = ev.clientY - r2.top - offY;
        const dx = curGX - gx, dy = curGY - gy;
        const alongDelta = dx * alongX + dy * alongY;
        const perpDelta = dx * perpX + dy * perpY;

        const newAngle = angle0 + perpDelta * ROTATE_SENSITIVITY;
        let newLenFwd = lenFwd0, newLenBwd = lenBwd0;
        if (end === 'fwd') newLenFwd = Math.max(MIN_LEN, lenFwd0 + alongDelta);
        else newLenBwd = Math.max(MIN_LEN, lenBwd0 - alongDelta);

        pattern.tangentOverrides[reel] = { angle: newAngle, lenFwd: newLenFwd, lenBwd: newLenBwd };
        drawGrid();
        drawPreview();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return;
  }

  const pattern = activePattern();
  if (!pattern) return;

  // 2) clicking directly on a placed point's dot selects it (shows its
  // tangent handle) instead of re-placing it — immediate, no drag
  const dotHit = hitTestPointDot(pattern, gx, gy);
  if (dotHit != null) {
    if (e.ctrlKey || e.metaKey) toggleSelectedReel(pattern, dotHit);
    else setSelectedReels(pattern, [dotHit]);
    drawGrid();
    return;
  }

  // 3) anything else: wait to see if this becomes a drag (rubber-band
  // select) or stays a simple click (place a point in the clicked
  // cell, or — if the click hit no cell at all — clear the selection)
  const startClientX = e.clientX, startClientY = e.clientY;
  const ctrlHeld = e.ctrlKey || e.metaKey;
  const CLICK_DRAG_THRESHOLD = 4;
  let dragging = false;

  const onMove = (ev) => {
    const dx = ev.clientX - startClientX, dy = ev.clientY - startClientY;
    if (!dragging && Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) dragging = true;
    if (!dragging) return;
    const r2 = gridCanvas.getBoundingClientRect();
    const curX = ev.clientX - r2.left - offX, curY = ev.clientY - r2.top - offY;
    dragSelectRect = {
      x0: Math.min(gx, curX), y0: Math.min(gy, curY),
      x1: Math.max(gx, curX), y1: Math.max(gy, curY)
    };
    drawGrid();
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (dragging && dragSelectRect) {
      const pts = patternPoints(pattern);
      const hitReels = [];
      if (pts) {
        const { x0, y0, x1, y1 } = dragSelectRect;
        pts.forEach((p, i) => {
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hitReels.push(i);
        });
      }
      if (ctrlHeld) {
        const merged = new Set(pattern.selectedReels || []);
        hitReels.forEach((i) => merged.add(i));
        setSelectedReels(pattern, [...merged]);
      } else {
        setSelectedReels(pattern, hitReels);
      }
      dragSelectRect = null;
      drawGrid();
    } else {
      const hit = gridClickToCell(mx, my);
      if (hit) {
        pattern.points[hit.reel] = hit.row;
        recomputeWarning(pattern);
        renderAll();
      } else {
        // clicked truly empty space — clear the tangent selection
        setSelectedReels(pattern, []);
        drawGrid();
      }
    }
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

// double-click a tangent handle to reset that point back to the
// auto-computed tangent
gridCanvas.addEventListener('dblclick', (e) => {
  const rectBounds = gridCanvas.getBoundingClientRect();
  const mx = e.clientX - rectBounds.left, my = e.clientY - rectBounds.top;
  const { offX, offY } = gridSpaceOffset();
  const handleHit = hitTestTangentHandle(mx - offX, my - offY);
  if (handleHit) {
    const pattern = activePattern();
    // Double-click a handle: drop the manual override entirely and go
    // back to the auto-computed tangent for that point.
    pattern.tangentOverrides[handleHit.reel] = null;
    renderAll();
  }
});

window.addEventListener('resize', () => { drawGrid(); drawPreview(); });

// ==================================================================
// Preview panel resize (drag handle)
// ==================================================================
(function setupPreviewResize() {
  const handle = el('previewResizeHandle');
  const strip = el('previewStrip');
  const center = strip.parentElement;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
    const startY = e.clientY;
    const startHeight = strip.getBoundingClientRect().height;
    const centerH = center.getBoundingClientRect().height;

    const onMove = (ev) => {
      const delta = startY - ev.clientY; // dragging up increases preview height
      let newHeight = startHeight + delta;
      const min = 110, max = centerH * 0.8;
      newHeight = Math.max(min, Math.min(max, newHeight));
      strip.style.flexBasis = `${newHeight}px`;
      drawGrid();
      drawPreview();
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
})();

// ==================================================================
// Pattern list UI
// ==================================================================
function renderPatternList() {
  patternListEl.innerHTML = '';
  state.patterns.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'pattern-row' + (p.id === state.activePatternId ? ' active' : '');
    row.innerHTML = `
      <span class="name">${p.name}</span>
      ${p.warn ? '<span class="warn" title="Khúc cong quá gắt">⚠</span>' : ''}
      <span class="row-actions">
        <span data-act="clone" title="Clone">⧉</span>
        <span data-act="delete" title="Xoá">🗑</span>
      </span>
    `;
    row.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (act === 'clone') { addPattern(p); return; }
      if (act === 'delete') { deletePattern(p.id); return; }
      state.activePatternId = p.id;
      renderAll();
    });
    patternListEl.appendChild(row);
  });
  el('exportCount').textContent = state.patterns.filter((p) => patternPoints(p)).length;
  el('baseNamePreview').textContent = `${state.baseName}_01, _02, ...`;
}

el('btnAddPattern').addEventListener('click', () => addPattern(null));

el('skeletonName').addEventListener('input', (e) => {
  state.skeletonName = e.target.value.trim() || 'Skeleton';
});

el('baseName').addEventListener('input', (e) => {
  state.baseName = e.target.value.trim() || 'Payline';
  renumberPatterns();
  renderPatternList();
});

el('tension').addEventListener('input', (e) => {
  el('tensionVal').textContent = e.target.value;
  const p = activePattern();
  if (p) { p.tension = Number(e.target.value); recomputeWarning(p); renderAll(); }
});

el('density').addEventListener('input', (e) => {
  el('densityVal').textContent = e.target.value;
  state.density = Number(e.target.value);
  rebuildMesh();
  renderAll();
});

el('gridRows').addEventListener('input', (e) => {
  el('gridRowsVal').textContent = e.target.value;
  state.gridRows = Number(e.target.value);
  rebuildMesh();
  renderAll();
});

el('boneAuto').addEventListener('change', (e) => {
  state.boneAuto = e.target.checked;
  el('boneCountSlider').disabled = state.boneAuto;
  rebuildMesh();
  renderAll();
});

el('boneCountSlider').addEventListener('input', (e) => {
  state.boneCount = Number(e.target.value);
  el('boneCountVal').textContent = e.target.value;
  if (!state.boneAuto) { rebuildMesh(); renderAll(); }
});

el('btnResetBgAdjust').addEventListener('click', () => {
  state.bgOpacity = 100;
  state.bgBrightness = 0;
  el('bgOpacity').value = 100;
  el('bgOpacityVal').textContent = '100';
  el('bgBrightness').value = 0;
  el('bgBrightnessVal').textContent = '0';
  drawGrid();
});

el('bgOpacity').addEventListener('input', (e) => {
  state.bgOpacity = Number(e.target.value);
  el('bgOpacityVal').textContent = e.target.value;
  drawGrid();
});

el('bgBrightness').addEventListener('input', (e) => {
  state.bgBrightness = Number(e.target.value);
  el('bgBrightnessVal').textContent = e.target.value;
  drawGrid();
});

// ==================================================================
// Flipbook import
// ==================================================================
el('btnImportFlipbook').addEventListener('click', async () => {
  const files = await window.paylineAPI.openFlipbookFolder();
  if (!files.length) return toast('Không tìm thấy ảnh PNG/JPG nào trong thư mục đã chọn.');
  const loaded = await Promise.all(files.map((f) => loadImage(f.dataUrl).then((img) => ({ name: baseNameNoExt(f.name), img }))));
  state.flipbook = loaded;
  el('scrubBar').max = String(Math.max(0, loaded.length - 1));
  state.scrubIndex = 0;
  rebuildMesh();
  renderAll();
  const btn = el('btnImportFlipbook');
  btn.classList.add('imported');
  btn.textContent = `✓ Flipbook (${loaded.length} frame)`;
  toast(`Đã nạp ${loaded.length} frame flipbook.`);
});

function baseNameNoExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rebuildMesh() {
  syncBoneSliderMin();
  if (!state.flipbook.length) { state.mesh = null; return; }
  const first = state.flipbook[0].img;
  const curveBones = effectiveBoneCount();
  state.mesh = buildRibbonMesh(first.naturalWidth, first.naturalHeight, curveBones + END_BONES, state.density, state.gridRows);
  el('boneCountVal').textContent = curveBones;
  if (state.boneAuto) el('boneCountSlider').value = curveBones;
}

function syncBoneSliderMin() {
  // the true minimum is always 1 bone per reel (see snapBoneCountToReels) —
  // keep the slider's own min in sync so users can actually reach it
  const reels = Math.max(1, state.gridConfig.reels);
  const slider = el('boneCountSlider');
  slider.min = String(reels);
  if (Number(slider.value) < reels) slider.value = String(reels);
  if (state.boneCount < reels) state.boneCount = reels;
}

// ==================================================================
// Background reference image
// ==================================================================
el('btnImportBg').addEventListener('click', async () => {
  const f = await window.paylineAPI.openSingleImage();
  if (!f) return;
  const img = await loadImage(f.dataUrl);
  state.bgImage = { img, x: 0, y: 0, scale: 1, locked: false };
  state.bgEditBackup = null;
  state.bgEditing = true;
  state.bgVisible = true;
  el('bgEditControls').style.display = 'flex';
  el('btnEditBg').style.display = 'inline-block';
  el('btnToggleBg').style.display = 'inline-block';
  el('btnToggleBg').textContent = '👁 Ẩn nền';
  el('bgBrightnessSection').style.display = 'block';
  drawGrid();
});

el('btnEditBg').addEventListener('click', () => {
  if (!state.bgImage) return;
  state.bgEditBackup = { x: state.bgImage.x, y: state.bgImage.y, scale: state.bgImage.scale };
  state.bgEditing = true;
  state.bgImage.locked = false;
  el('bgEditControls').style.display = 'flex';
  drawGrid();
});

el('btnToggleBg').addEventListener('click', () => {
  state.bgVisible = !state.bgVisible;
  el('btnToggleBg').textContent = state.bgVisible ? '👁 Ẩn nền' : '🚫 Hiện nền';
  drawGrid();
});

el('btnBgDone').addEventListener('click', () => {
  state.bgEditing = false;
  if (state.bgImage) state.bgImage.locked = true;
  state.bgEditBackup = null;
  el('bgEditControls').style.display = 'none';
  drawGrid();
});

el('btnBgCancel').addEventListener('click', () => {
  state.bgEditing = false;
  if (state.bgImage && state.bgEditBackup) {
    Object.assign(state.bgImage, state.bgEditBackup);
  }
  if (state.bgImage) state.bgImage.locked = true;
  state.bgEditBackup = null;
  el('bgEditControls').style.display = 'none';
  drawGrid();
});

// ==================================================================
// Grid config modal
// ==================================================================
function openGridConfigModal() {
  el('cfgReels').value = state.gridConfig.reels;
  el('cfgGridType').value = state.gridConfig.gridType;
  el('cfgStaggerOffset').value = state.gridConfig.staggerOffset;
  el('cfgCellW').value = state.gridConfig.cellW;
  el('cfgCellH').value = state.gridConfig.cellH;
  el('cfgGap').value = state.gridConfig.gap;
  el('cfgStrokeColor').value = state.gridConfig.strokeColor || '#4a2f7a';
  const { leadIn, leadOut } = leadLengths();
  el('cfgLeadIn').value = leadIn;
  el('cfgLeadOut').value = leadOut;
  syncLeadSliders();
  el('cfgStaggerRow').style.display = state.gridConfig.gridType === 'staggered' ? 'flex' : 'none';
  renderReelRowsConfig();
  el('gridConfigModal').style.display = 'flex';
}

function renderReelRowsConfig() {
  const reels = Number(el('cfgReels').value);
  const container = el('reelRowsConfig');
  const rows = state.gridConfig.rowsPerReel.slice(0, reels);
  while (rows.length < reels) rows.push(4);
  container.innerHTML = '';
  rows.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'reel-row';
    row.innerHTML = `<span>Reel ${i + 1}</span><input type="number" min="1" max="12" value="${val}" data-idx="${i}" style="flex:1;" />`;
    container.appendChild(row);
  });
}

// The end-bone sliders go from 0 (on the reel point) to one cell size, so
// their max follows the cell size typed in the same dialog.
function cfgFromInputs() {
  return { cellW: numOr(el('cfgCellW').value, 90, 1), cellH: numOr(el('cfgCellH').value, 90, 1) };
}
function syncLeadSliders() {
  const max = maxLeadLength(cfgFromInputs());
  ['cfgLeadIn', 'cfgLeadOut'].forEach((id) => {
    const input = el(id);
    const wasMax = Number(input.value) >= Number(input.max);
    input.max = String(max);
    if (wasMax || Number(input.value) > max) input.value = String(max);
    el(id + 'Val').textContent = input.value;
  });
}
['cfgLeadIn', 'cfgLeadOut'].forEach((id) => el(id).addEventListener('input', syncLeadSliders));
['cfgCellW', 'cfgCellH'].forEach((id) => el(id).addEventListener('input', syncLeadSliders));

// Number from an input, keeping 0 (a plain `|| fallback` turned a 0 gap into 6).
function numOr(value, fallback, min = 0) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

el('btnGridConfig').addEventListener('click', openGridConfigModal);
el('cfgReels').addEventListener('input', renderReelRowsConfig);
el('btnAddReel').addEventListener('click', () => {
  el('cfgReels').value = Number(el('cfgReels').value) + 1;
  renderReelRowsConfig();
});
el('cfgGridType').addEventListener('change', (e) => {
  el('cfgStaggerRow').style.display = e.target.value === 'staggered' ? 'flex' : 'none';
});
el('btnCancelGridConfig').addEventListener('click', () => (el('gridConfigModal').style.display = 'none'));

el('btnApplyGridConfig').addEventListener('click', () => {
  const reels = Number(el('cfgReels').value);
  const rowsPerReel = Array.from(el('reelRowsConfig').querySelectorAll('input')).map((i) => Number(i.value) || 3);
  state.gridConfig = {
    reels,
    rowsPerReel,
    cellW: numOr(el('cfgCellW').value, 90, 1),
    cellH: numOr(el('cfgCellH').value, 90, 1),
    gap: numOr(el('cfgGap').value, 6),
    gridType: el('cfgGridType').value,
    staggerOffset: Number(el('cfgStaggerOffset').value) || 0,
    strokeColor: el('cfgStrokeColor').value || '#4a2f7a',
    leadIn: numOr(el('cfgLeadIn').value, null),
    leadOut: numOr(el('cfgLeadOut').value, null)
  };
  // reset points (and their tangent overrides) length for patterns
  state.patterns.forEach((p) => {
    const pts = new Array(reels).fill(null);
    p.points.forEach((v, i) => { if (i < reels) pts[i] = v; });
    p.points = pts;
    const tans = new Array(reels).fill(null);
    (p.tangentOverrides || []).forEach((v, i) => { if (i < reels) tans[i] = v; });
    p.tangentOverrides = tans;
    p.selectedReels = (p.selectedReels || []).filter((i) => i < reels);
    recomputeWarning(p);
  });
  el('gridConfigModal').style.display = 'none';
  syncBoneSliderMin();
  renderAll();
});

// ==================================================================
// Grid presets
// ==================================================================
async function refreshPresetSelect() {
  state.presets = (await window.paylineAPI.loadPresets()) || {};
  const sel = el('presetSelect');
  sel.innerHTML = Object.keys(state.presets).map((n) => `<option value="${n}">${n}</option>`).join('') || '<option value="">(chưa có preset)</option>';
}

el('btnSavePreset').addEventListener('click', () => {
  el('presetNameInput').value = '';
  el('savePresetModal').style.display = 'flex';
});
el('btnCancelSavePreset').addEventListener('click', () => (el('savePresetModal').style.display = 'none'));
el('btnConfirmSavePreset').addEventListener('click', async () => {
  const name = el('presetNameInput').value.trim();
  if (!name) return;
  state.presets[name] = state.gridConfig;
  await window.paylineAPI.savePresets(state.presets);
  await refreshPresetSelect();
  el('presetSelect').value = name;
  el('savePresetModal').style.display = 'none';
});
el('btnLoadPreset').addEventListener('click', () => {
  const name = el('presetSelect').value;
  if (!name || !state.presets[name]) return;
  applyGridConfig(state.presets[name]);
});

// Export every saved preset into one .json file (to back up or send to someone).
el('btnExportPresetFile').addEventListener('click', async () => {
  if (!Object.keys(state.presets).length) return toast('Chưa có preset nào để xuất.');
  const res = await window.paylineAPI.exportPresetFile({ presets: state.presets });
  if (res && res.ok) toast(`Đã xuất ${Object.keys(state.presets).length} preset ra file.`);
  else if (res && res.error) toast(`Lỗi xuất preset: ${res.error}`);
});

// Import presets from a file made by "Xuất file". Presets with the same name are replaced.
el('btnImportPresetFile').addEventListener('click', async () => {
  const res = await window.paylineAPI.importPresetFile();
  if (!res || res.canceled) return;
  if (!res.ok) return toast(`Lỗi nhập preset: ${res.error}`);
  const incoming = Object.entries(res.presets || {}).filter(([n, cfg]) => n && isValidGridConfig(cfg));
  if (!incoming.length) return toast('File không có preset hợp lệ.');
  incoming.forEach(([n, cfg]) => { state.presets[n] = cfg; });
  await window.paylineAPI.savePresets(state.presets);
  await refreshPresetSelect();
  el('presetSelect').value = incoming[0][0];
  toast(`Đã nhập ${incoming.length} preset. Chọn preset rồi bấm Load để dùng.`);
});

function isValidGridConfig(cfg) {
  return cfg && typeof cfg === 'object' &&
    Number.isInteger(cfg.reels) && cfg.reels >= 1 &&
    Array.isArray(cfg.rowsPerReel) && cfg.rowsPerReel.length >= 1 &&
    Number.isFinite(cfg.cellW) && Number.isFinite(cfg.cellH);
}

function applyGridConfig(cfg) {
  state.gridConfig = { ...JSON.parse(JSON.stringify(cfg)) };
  if (!Number.isFinite(state.gridConfig.gap)) state.gridConfig.gap = 6;
  state.patterns.forEach((p) => {
    const pts = new Array(state.gridConfig.reels).fill(null);
    p.points.forEach((v, i) => { if (i < state.gridConfig.reels) pts[i] = v; });
    p.points = pts;
    const tans = new Array(state.gridConfig.reels).fill(null);
    (p.tangentOverrides || []).forEach((v, i) => { if (i < state.gridConfig.reels) tans[i] = v; });
    p.tangentOverrides = tans;
    p.selectedReels = (p.selectedReels || []).filter((i) => i < state.gridConfig.reels);
    recomputeWarning(p);
  });
  syncBoneSliderMin();
  renderAll();
}

// ==================================================================
// Preview rendering (triangle-warp skinned flipbook)
// ==================================================================
function drawTriangleImage(ctx, img, s0, s1, s2, d0, d1, d2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denom) < 1e-6) { ctx.restore(); return; }

  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;

  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawPreview() {
  const wrap = previewCanvas.parentElement;
  const rect = fitCanvasToStage(previewCanvas, wrap);
  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pattern = activePattern();
  const pts = pattern ? patternPoints(pattern) : null;
  if (!pattern || !pts || !state.mesh || !state.flipbook.length) {
    el('frameLabel').textContent = 'frame 0 / 0';
    return;
  }

  const { samples } = rigSamples(pattern, pts, state.mesh.boneCount - END_BONES);
  // fit curve bbox into preview canvas
  const xs = samples.map((s) => s.x), ys = samples.map((s) => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const spanX = Math.max(40, maxX - minX), spanY = Math.max(40, maxY - minY);
  const baseScale = Math.min((rect.width - 30) / spanX, (rect.height - 30) / spanY, 1.6);
  const scale = baseScale * state.previewZoom;

  const boneWorldPos = samples.map((s) => ({
    x: (s.x - cx) * scale + rect.width / 2 + state.previewPan.x,
    y: (s.y - cy) * scale + rect.height / 2 + state.previewPan.y
  }));
  const tangents = computeTangents(boneWorldPos);
  boneWorldPos.forEach((bp, i) => { bp.angle = tangents[i]; });
  // convert to mesh's own local frame (boneWorldPos already absolute canvas coords;
  // skinVertices expects positions consistent with mesh.boneRestX scale, so we
  // instead directly interpolate using weights against these screen-space bone points)
  const verts = skinVerticesScreenSpace(state.mesh, boneWorldPos, scale);

  const frameIdx = Math.min(state.scrubIndex, state.flipbook.length - 1);
  const img = state.flipbook[frameIdx].img;
  const tris = state.mesh.triangles;

  const srcFor = (idx) => {
    const v = state.mesh.vertsRest[idx];
    return { x: v.u * img.naturalWidth, y: v.v * img.naturalHeight };
  };

  ctx.globalCompositeOperation = 'lighter';
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    drawTriangleImage(ctx, img, srcFor(a), srcFor(b), srcFor(c), verts[a], verts[b], verts[c]);
  }
  ctx.globalCompositeOperation = 'source-over';

  if (state.showMeshWire) {
    ctx.save();
    ctx.globalAlpha = state.meshOpacity / 100;
    ctx.strokeStyle = 'rgba(53,228,245,.7)';
    ctx.lineWidth = 1;
    for (let t = 0; t < tris.length; t += 3) {
      const a = verts[tris[t]], b = verts[tris[t + 1]], c = verts[tris[t + 2]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  if (state.showBones) {
    ctx.strokeStyle = 'rgba(255,79,163,.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    boneWorldPos.forEach((bp, i) => (i === 0 ? ctx.moveTo(bp.x, bp.y) : ctx.lineTo(bp.x, bp.y)));
    ctx.stroke();
    boneWorldPos.forEach((bp) => {
      ctx.fillStyle = '#ff4fa3';
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  el('frameLabel').textContent = `frame ${frameIdx + 1} / ${state.flipbook.length}`;
}

function skinVerticesScreenSpace(mesh, boneScreenPos, scale) {
  return mesh.weights.map((vw) => {
    let x = 0, y = 0;
    for (const w of vw) {
      const bp = boneScreenPos[w.bone];
      const angle = bp.angle || 0;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rx = w.offsetX * cos - w.offsetY * sin;
      const ry = w.offsetX * sin + w.offsetY * cos;
      x += (bp.x + rx * scale) * w.weight;
      y += (bp.y + ry * scale) * w.weight;
    }
    return { x, y };
  });
}

previewCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  state.previewZoom = Math.max(0.2, Math.min(6, state.previewZoom * factor));
  drawPreview();
}, { passive: false });

previewCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 1) return; // middle mouse only
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const origPan = { ...state.previewPan };
  const onMove = (ev) => {
    state.previewPan = {
      x: origPan.x + (ev.clientX - startX),
      y: origPan.y + (ev.clientY - startY)
    };
    drawPreview();
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});
previewCanvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

el('toggleMeshWire').addEventListener('change', (e) => {
  state.showMeshWire = e.target.checked;
  el('meshOpacityRow').style.display = state.showMeshWire ? 'flex' : 'none';
  drawPreview();
});
el('meshOpacity').addEventListener('input', (e) => {
  state.meshOpacity = Number(e.target.value);
  el('meshOpacityVal').textContent = e.target.value;
  drawPreview();
});
el('toggleBones').addEventListener('change', (e) => {
  state.showBones = e.target.checked;
  drawPreview();
});

let playTimer = null;
el('btnPlayPause').addEventListener('click', () => {
  state.playing = !state.playing;
  el('btnPlayPause').textContent = state.playing ? '⏸' : '▶';
  if (state.playing) {
    playTimer = setInterval(() => {
      if (!state.flipbook.length) return;
      state.scrubIndex = (state.scrubIndex + 1) % state.flipbook.length;
      el('scrubBar').value = String(state.scrubIndex);
      drawPreview();
    }, 1000 / 30);
  } else {
    clearInterval(playTimer);
  }
});

el('scrubBar').addEventListener('input', (e) => {
  state.scrubIndex = Number(e.target.value);
  drawPreview();
});

// ==================================================================
// Export
// ==================================================================
el('btnChooseOutput').addEventListener('click', async () => {
  const dir = await window.paylineAPI.chooseOutputFolder();
  if (dir) { state.outputPath = dir; el('outputPath').value = dir; }
});

el('trimAtlas').addEventListener('change', (e) => {
  state.trimAtlas = e.target.checked;
});

el('btnExportAll').addEventListener('click', async () => {
  if (!state.flipbook.length) return toast('Chưa import flipbook.');
  if (!state.outputPath) return toast('Chưa chọn output folder.');
  const exportable = state.patterns.filter((p) => patternPoints(p));
  if (!exportable.length) return toast('Chưa có pattern hợp lệ nào (đủ 1 điểm/reel).');

  const layout = buildGridLayout(state.gridConfig);
  const gridRect = { width: layout.totalW, height: layout.totalH };
  const gridCenter = { x: gridRect.width / 2, y: gridRect.height / 2 };

  const pack = packFrames(state.flipbook.map((f) => ({ name: f.name, img: f.img })), 2, 2048, state.trimAtlas);
  const atlasText = buildAtlasText(state.skeletonName, pack);

  const patternsForExport = exportable.map((p) => ({
    id: p.id,
    name: p.name,
    points: patternPoints(p),
    tension: p.tension / 100,
    sampleCount: state.mesh.boneCount - END_BONES,
    tangentOverrides: p.tangentOverrides,
    ...leadLengths()
  }));

  const { json } = buildSpineJson({
    skeletonName: state.skeletonName,
    frameNames: state.flipbook.map((f) => f.name),
    frameW: pack.frameW,
    frameH: pack.frameH,
    mesh: state.mesh,
    gridCenter,
    patterns: patternsForExport,
    fps: 30,
    additiveBlend: true
  });

  const pngPages = pack.pages.map((page, i) => ({
    fileName: pageFileName(state.skeletonName, i),
    dataUrl: page.canvas.toDataURL('image/png')
  }));

  const res = await window.paylineAPI.exportBundle({
    outputDir: state.outputPath,
    baseName: state.skeletonName,
    jsonText: JSON.stringify(json, null, 2),
    atlasText,
    pngPages
  });

  const pageNote = pngPages.length > 1 ? ` (chia ${pngPages.length} trang PNG do vượt 2048px)` : '';
  toast(res.ok ? `Đã export ${exportable.length} animation vào ${state.outputPath}${pageNote}` : `Lỗi export: ${res.error}`);
});

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ==================================================================
// Render loop glue
// ==================================================================
function renderAll() {
  if (state.flipbook.length) rebuildMesh();
  renderPatternList();
  drawGrid();
  drawPreview();
}

(async function init() {
  await refreshPresetSelect();
  addPattern(null);
  syncBoneSliderMin();
  el('boneCountSlider').disabled = state.boneAuto;
  renderAll();
})();
