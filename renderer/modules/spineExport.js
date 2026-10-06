import { buildCurve, computeTangents } from './spline.js';

// Builds a full Spine 3.7.94 skeleton JSON:
//   bones: root -> pline -> p0..p(N-1)  (control bones, hose-rig)
//   slots: pline (mesh flipbook)
//   skins.default.pline: base mesh + linkedmesh per remaining frame
//   animations: one per pattern — attachment cycling + control-bone translate

export function buildSpineJson({
  skeletonName,
  imageDir = './images/',
  frameNames,       // ordered list of frame attachment names, e.g. ["PayLine_01", ...]
  frameW, frameH,
  mesh,             // from buildRibbonMesh()
  gridCenter,       // {x,y} in grid-canvas pixel space treated as Spine origin
  patterns,         // [{ id, name, points: [{x,y}...] (grid px, 1 per reel), tension, sampleCount, tangentOverrides }]
  fps = 30,
  additiveBlend = true
}) {
  const boneCount = mesh.boneCount;

  const bones = [
    { name: 'root' },
    { name: 'pline', parent: 'root' }
  ];
  for (let i = 0; i < boneCount; i++) {
    bones.push({ name: `p${i}`, parent: 'pline', x: round2(mesh.boneRestX[i]), y: 0 });
  }
  // global index lookup for mesh vertex weight encoding
  const boneGlobalIndex = {};
  bones.forEach((b, idx) => { boneGlobalIndex[b.name] = idx; });

  const slots = [
    { name: 'pline', bone: 'pline', attachment: frameNames[0], blend: additiveBlend ? 'additive' : 'normal' }
  ];

  // ---- skins ----
  const baseFrame = frameNames[0];
  const uvs = [];
  mesh.vertsRest.forEach((v) => uvs.push(round4(v.u), round4(v.v)));

  const verticesEncoded = [];
  mesh.weights.forEach((vw) => {
    verticesEncoded.push(vw.length);
    vw.forEach((w) => {
      verticesEncoded.push(
        boneGlobalIndex[`p${w.bone}`],
        round2(w.offsetX),
        round2(w.offsetY),
        round5(w.weight)
      );
    });
  });

  const hullCount = mesh.hullCount;
  const edges = [];
  for (let i = 0; i < hullCount; i++) {
    edges.push(i * 2, ((i + 1) % hullCount) * 2);
  }

  const defaultSkin = { pline: {} };
  defaultSkin.pline[baseFrame] = {
    type: 'mesh',
    uvs,
    triangles: mesh.triangles,
    vertices: verticesEncoded,
    hull: hullCount,
    edges,
    width: frameW,
    height: frameH
  };
  for (let i = 1; i < frameNames.length; i++) {
    defaultSkin.pline[frameNames[i]] = {
      type: 'linkedmesh',
      parent: baseFrame,
      width: frameW,
      height: frameH
    };
  }

  // ---- animations ----
  const frameDuration = 1 / fps;
  const cycleDuration = frameDuration * frameNames.length;
  const warnings = {};

  const animations = {};
  for (const pattern of patterns) {
    const { samples, maxTurnAngle } = buildCurve(pattern.points, pattern.tension, boneCount, pattern.tangentOverrides);
    warnings[pattern.id] = maxTurnAngle;

    const boneTimelines = {};
    const localPoints = samples.map((s) => ({
      x: s.x - gridCenter.x,
      y: -(s.y - gridCenter.y) // flip Y: canvas down -> Spine up
    }));
    const tangents = computeTangents(localPoints);

    localPoints.forEach((lp, i) => {
      const dx = round2(lp.x - mesh.boneRestX[i]);
      const dy = round2(lp.y - 0);
      const angleDeg = round2(tangents[i] * (180 / Math.PI));
      boneTimelines[`p${i}`] = {
        rotate: [{ time: 0, angle: angleDeg }],
        translate: [{ time: 0, x: dx, y: dy }]
      };
    });

    const attachmentKeys = frameNames.map((name, i) => ({ time: round4(i * frameDuration), name }));

    animations[pattern.name] = {
      slots: { pline: { attachment: attachmentKeys } },
      bones: boneTimelines
    };
  }

  const skeleton = {
    skeleton: {
      hash: pseudoHash(skeletonName),
      spine: '3.7.94',
      width: frameW,
      height: frameH,
      images: imageDir,
      audio: ''
    },
    bones,
    slots,
    skins: { default: defaultSkin },
    animations
  };

  return { json: skeleton, warnings, cycleDuration };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
function round5(n) { return Math.round(n * 100000) / 100000; }
function pseudoHash(seed) {
  let h = 0;
  const s = `${seed}-${Date.now()}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
