// Packs an array of loaded HTMLImageElements (flipbook frames, same size)
// into one or more atlas PNG "pages" using shelf packing.
// Each page is capped at maxPageSize (Spine-friendly, default 2048) on
// both dimensions and rounded up to a multiple of 4; if all frames don't
// fit on one page, the packer automatically splits into multiple pages.
//
// When `trim` is true, the empty (fully transparent) rows above and below the
// artwork are cropped away — the SAME rows for every frame, symmetric around
// the frame's middle line so the artwork stays centred on the payline. The
// width is never cropped (it maps onto the whole payline length).
//
// Every frame must keep one shared size: the frames are mesh attachments, and
// a mesh covers its whole region. Trimming each frame to its own box (with
// orig/offset in the .atlas) made Spine runtimes either stretch the frame or
// sample past it into the neighbouring frames of the atlas (several beams
// showing at once). The caller builds the mesh at the returned frameW/frameH.

function roundUp4(n) {
  return Math.ceil(n / 4) * 4;
}

// Scans a frame for its opaque bounding box (alpha > 0). Returns null if the
// frame is fully transparent (caller should fall back to the full frame).
function getAlphaBBox(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.clearRect(0, 0, c.width, c.height);
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, c.width, c.height).data;

  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    const rowOffset = y * c.width * 4;
    for (let x = 0; x < c.width; x++) {
      const a = data[rowOffset + x * 4 + 3];
      if (a > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // fully transparent
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Rows to keep when trimming: [top, top + height), symmetric around the
// frame's centre line and covering the opaque pixels of every frame.
function sharedVerticalCrop(frames, fh) {
  let minY = fh, maxY = -1;
  for (const f of frames) {
    const bbox = getAlphaBBox(f.img);
    if (!bbox) continue;
    minY = Math.min(minY, bbox.y);
    maxY = Math.max(maxY, bbox.y + bbox.h);
  }
  if (maxY < 0) return { top: 0, height: fh }; // every frame empty
  const half = Math.ceil(Math.max(fh / 2 - minY, maxY - fh / 2));
  const top = Math.max(0, Math.floor(fh / 2 - half));
  return { top, height: Math.min(fh, Math.ceil(fh / 2 + half)) - top };
}

// Per-frame source rect to copy from + its atlas metadata (all the same size).
function buildFrameRects(frames, fw, fh, trim) {
  const { top, height } = trim ? sharedVerticalCrop(frames, fh) : { top: 0, height: fh };
  return frames.map((f) => ({
    name: f.name, img: f.img, sx: 0, sy: top, sw: fw, sh: height, offX: 0, offY: 0, origW: fw, origH: height
  }));
}

// Simple shelf (row) packer that supports variable-size rects (needed once
// frames are individually trimmed). Splits into a new page once a rect no
// longer fits within maxPageSize vertically.
function shelfPack(rects, padding, maxPageSize) {
  const pages = [];
  let cur = null;
  const newBucket = () => ({ items: [], x: padding, y: padding, rowH: 0, maxX: 0, maxY: 0 });
  cur = newBucket();

  for (const r of rects) {
    if (cur.x !== padding && cur.x + r.sw + padding > maxPageSize) {
      // wrap to next row on this page
      cur.x = padding;
      cur.y += cur.rowH + padding;
      cur.rowH = 0;
    }
    if (cur.y !== padding && cur.y + r.sh + padding > maxPageSize) {
      // this page is full, start a new one
      pages.push(cur);
      cur = newBucket();
    }
    cur.items.push({ ...r, x: cur.x, y: cur.y });
    cur.maxX = Math.max(cur.maxX, cur.x + r.sw + padding);
    cur.maxY = Math.max(cur.maxY, cur.y + r.sh + padding);
    cur.x += r.sw + padding;
    cur.rowH = Math.max(cur.rowH, r.sh);
  }
  pages.push(cur);
  return pages;
}

export function packFrames(frames, padding = 2, maxPageSize = 2048, trim = false) {
  const fw = frames[0].img.naturalWidth;
  const fh = frames[0].img.naturalHeight;

  const rects = buildFrameRects(frames, fw, fh, trim);
  const frameH = rects[0].sh;
  const pageBuckets = shelfPack(rects, padding, maxPageSize);

  const pages = pageBuckets.map((bucket) => {
    const atlasW = Math.min(maxPageSize, roundUp4(bucket.maxX));
    const atlasH = Math.min(maxPageSize, roundUp4(bucket.maxY));

    const canvas = document.createElement('canvas');
    canvas.width = atlasW;
    canvas.height = atlasH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, atlasW, atlasH);

    const placements = bucket.items.map((it) => {
      ctx.drawImage(it.img, it.sx, it.sy, it.sw, it.sh, it.x, it.y, it.sw, it.sh);
      return { name: it.name, x: it.x, y: it.y, w: it.sw, h: it.sh, offX: it.offX, offY: it.offY, origW: it.origW, origH: it.origH };
    });

    return { canvas, atlasW, atlasH, placements };
  });

  // frameW/frameH = size of every packed frame; the mesh must be built at this size
  return { pages, frameW: fw, frameH };
}

export function buildAtlasText(baseName, packResult) {
  const lines = [];
  packResult.pages.forEach((page, i) => {
    const pngName = i === 0 ? `${baseName}.png` : `${baseName}_${i + 1}.png`;
    lines.push(pngName);
    lines.push(`size: ${page.atlasW},${page.atlasH}`);
    lines.push('format: RGBA8888');
    lines.push('filter: Linear,Linear');
    lines.push('repeat: none');
    for (const p of page.placements) {
      lines.push(p.name);
      lines.push('  rotate: false');
      lines.push(`  xy: ${p.x}, ${p.y}`);
      lines.push(`  size: ${p.w}, ${p.h}`);
      lines.push(`  orig: ${p.origW}, ${p.origH}`);
      lines.push(`  offset: ${p.offX}, ${p.offY}`);
      lines.push('  index: -1');
    }
  });
  return lines.join('\n') + '\n';
}

export function pageFileName(baseName, pageIndex) {
  return pageIndex === 0 ? `${baseName}.png` : `${baseName}_${pageIndex + 1}.png`;
}
