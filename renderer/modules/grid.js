// Computes cell rects/centers for a reel grid: reels can each have a
// different row count (megaways-style), and the grid can be straight
// or staggered (alternate columns offset vertically).

export function buildGridLayout(config) {
  // config: { reels: number, rowsPerReel: number[], cellW, cellH, gap, gridType, staggerOffset }
  const { reels, rowsPerReel, cellW, cellH, gap, gridType, staggerOffset } = config;
  const maxRows = Math.max(...rowsPerReel);
  const totalGridH = maxRows * cellH + (maxRows - 1) * gap;

  const columns = [];
  for (let r = 0; r < reels; r++) {
    const rows = rowsPerReel[r] ?? rowsPerReel[rowsPerReel.length - 1];
    const colH = rows * cellH + (rows - 1) * gap;
    let yOffset = (totalGridH - colH) / 2;
    if (gridType === 'staggered' && r % 2 === 1) {
      yOffset += staggerOffset;
    }
    const cells = [];
    for (let row = 0; row < rows; row++) {
      const y = yOffset + row * (cellH + gap);
      cells.push({
        row,
        x: r * (cellW + gap),
        y,
        w: cellW,
        h: cellH,
        cx: r * (cellW + gap) + cellW / 2,
        cy: y + cellH / 2
      });
    }
    columns.push(cells);
  }

  const totalW = reels * cellW + (reels - 1) * gap;
  const totalH = totalGridH + (gridType === 'staggered' ? staggerOffset : 0);

  return { columns, totalW, totalH };
}
