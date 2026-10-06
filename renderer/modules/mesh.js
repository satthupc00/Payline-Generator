// Builds a grid mesh (rows x columns) over the flipbook frame's rest-pose
// rectangle, and skins each vertex to the two nearest control bones
// (linear blend, "hose rig" style). Mesh column density (visual
// subdivision along the curve) and row count (subdivision across the
// ribbon's height, 2-4) are both independent from bone count.
//
// Vertex order: boundary/hull vertices first (perimeter loop, required
// by Spine's mesh format), then any interior vertices (only present
// when rows > 2 and columns > 2) after.

export function buildRibbonMesh(frameWidth, frameHeight, boneCount, columns, rows = 2) {
  columns = Math.max(columns, 2);
  rows = Math.max(2, Math.min(20, rows));
  const halfH = frameHeight / 2;

  // grid[r][c] rest position
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const fy = rows === 1 ? 0 : r / (rows - 1);
    const y = fy * frameHeight - halfH;
    const row = [];
    for (let c = 0; c < columns; c++) {
      const fx = c / (columns - 1);
      const x = fx * frameWidth - frameWidth / 2;
      row.push({ x, y, u: fx, v: fy });
    }
    grid.push(row);
  }

  // ---- boundary (hull) loop: top row L->R, right col top->bottom,
  // bottom row R->L, left col bottom->top (each corner counted once) ----
  const hullCoords = [];
  for (let c = 0; c < columns; c++) hullCoords.push([0, c]);
  for (let r = 1; r < rows; r++) hullCoords.push([r, columns - 1]);
  for (let c = columns - 2; c >= 0; c--) hullCoords.push([rows - 1, c]);
  for (let r = rows - 2; r >= 1; r--) hullCoords.push([r, 0]);

  const indexOf = {}; // "r,c" -> flat vertex index
  const vertsRest = [];
  hullCoords.forEach(([r, c]) => {
    indexOf[`${r},${c}`] = vertsRest.length;
    vertsRest.push(grid[r][c]);
  });

  // interior vertices (only when rows>2 and columns>2)
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < columns - 1; c++) {
      indexOf[`${r},${c}`] = vertsRest.length;
      vertsRest.push(grid[r][c]);
    }
  }

  const idx = (r, c) => indexOf[`${r},${c}`];

  const triangles = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const a = idx(r, c), b = idx(r, c + 1), cc = idx(r + 1, c), d = idx(r + 1, c + 1);
      triangles.push(a, b, d);
      triangles.push(a, d, cc);
    }
  }

  const boneRestX = [];
  for (let i = 0; i < boneCount; i++) {
    boneRestX.push((i / (boneCount - 1)) * frameWidth - frameWidth / 2);
  }

  const weightFor = (v) => {
    let i = 0;
    while (i < boneCount - 2 && boneRestX[i + 1] < v.x) i++;
    const x0 = boneRestX[i], x1 = boneRestX[i + 1];
    const span = x1 - x0 || 1;
    let w1 = (v.x - x0) / span;
    w1 = Math.max(0, Math.min(1, w1));
    const w0 = 1 - w1;
    return [
      { bone: i, offsetX: v.x - x0, offsetY: v.y, weight: w0 },
      { bone: i + 1, offsetX: v.x - x1, offsetY: v.y, weight: w1 }
    ];
  };

  const weights = vertsRest.map(weightFor);

  return { columns, rows, vertsRest, triangles, weights, boneRestX, boneCount, hullCount: hullCoords.length };
}

export function skinVertices(mesh, boneWorldPos) {
  // boneWorldPos[i] = { x, y, angle? } — angle in radians, defaults to 0.
  return mesh.weights.map((vw) => {
    let x = 0, y = 0;
    for (const w of vw) {
      const bp = boneWorldPos[w.bone];
      const angle = bp.angle || 0;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rx = w.offsetX * cos - w.offsetY * sin;
      const ry = w.offsetX * sin + w.offsetY * cos;
      x += (bp.x + rx) * w.weight;
      y += (bp.y + ry) * w.weight;
    }
    return { x, y };
  });
}
