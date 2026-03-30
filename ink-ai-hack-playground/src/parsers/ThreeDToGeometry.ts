// ThreeDToGeometry — loads 3D files (STL, OBJ) and produces 2D geometry
// primitives for the CAD sketch animation pipeline.
//
// Hidden-line removal: instead of projecting ALL edges (which causes back-face
// edges to overlap front-face edges, producing dark blobs), we:
//   1. Iterate every triangle face, compute its normal, check front-facing
//   2. Build a position-keyed edge map tracking which faces share each edge
//   3. Include only:
//      - Silhouette edges (one face front, one back) — always visible
//      - Sharp feature edges (both faces front, dihedral angle > threshold)
//      - Boundary edges (one face only, front-facing)
//   4. Project surviving visible edges → 2D screen coords
//   5. Chain collinear adjacent segments → long smooth strokes

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import type { GeometryPrimitive } from './SvgParser';

// ── File loaders ──────────────────────────────────────────────────────────────

export function loadStlGeometry(buffer: ArrayBuffer): THREE.BufferGeometry {
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);
  geometry.computeVertexNormals();
  return geometry;
}

export function loadObjGeometry(text: string): THREE.BufferGeometry {
  const loader = new OBJLoader();
  const group = loader.parse(text);
  const meshes: THREE.Mesh[] = [];
  group.traverse(child => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  if (meshes.length === 0) return new THREE.BufferGeometry();
  if (meshes.length === 1) return meshes[0].geometry;
  const allPositions: number[] = [];
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      allPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  return merged;
}

// ── Hidden-line removal ────────────────────────────────────────────────────────
//
// Extracts only the edges that are actually visible from the camera:
//   - Silhouette edges: one face is front-facing, the adjacent face is back-facing
//   - Sharp feature edges: both faces front-facing, dihedral angle > threshold
//   - Boundary edges: only one face (mesh boundary), front-facing
//
// Back-face-only edges are excluded entirely.

function extractVisibleEdges(
  geometry: THREE.BufferGeometry,
  camera: THREE.Camera,
  thresholdAngle: number,
): [THREE.Vector3, THREE.Vector3][] {
  const posAttr = geometry.attributes.position;
  if (!posAttr) return [];

  // Camera look direction in world space (camera → scene = -Z rotated by quaternion)
  const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

  // Threshold: include edge when angle between face normals > thresholdAngle
  const cosThreshold = Math.cos(thresholdAngle * Math.PI / 180);

  // Position-based vertex key: quantize to avoid float noise
  // Scale chosen to match typical STL coordinate ranges
  const Q = 1000;
  const vk = (x: number, y: number, z: number) =>
    `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
  const ek = (k1: string, k2: string) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);

  type EdgeInfo = {
    v1: THREE.Vector3;
    v2: THREE.Vector3;
    normals: THREE.Vector3[];
    front: boolean[];
  };
  const edgeMap = new Map<string, EdgeInfo>();

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();

  const isIndexed = !!geometry.index;
  const faceCount = isIndexed
    ? geometry.index!.count / 3
    : posAttr.count / 3;

  for (let t = 0; t < faceCount; t++) {
    let ai: number, bi: number, ci: number;
    if (isIndexed) {
      ai = geometry.index!.getX(t * 3);
      bi = geometry.index!.getX(t * 3 + 1);
      ci = geometry.index!.getX(t * 3 + 2);
    } else {
      ai = t * 3;
      bi = t * 3 + 1;
      ci = t * 3 + 2;
    }
    va.fromBufferAttribute(posAttr, ai);
    vb.fromBufferAttribute(posAttr, bi);
    vc.fromBufferAttribute(posAttr, ci);

    // Face normal via cross product
    const ab = vb.clone().sub(va);
    const ac = vc.clone().sub(va);
    const normal = ab.cross(ac).normalize();
    if (normal.lengthSq() < 1e-10) continue; // degenerate triangle

    // Front-facing: normal opposes camera direction
    const isFront = normal.dot(camDir) < 0;

    const ka = vk(va.x, va.y, va.z);
    const kb = vk(vb.x, vb.y, vb.z);
    const kc = vk(vc.x, vc.y, vc.z);

    for (const [p1, p2, k1, k2] of [
      [va.clone(), vb.clone(), ka, kb],
      [vb.clone(), vc.clone(), kb, kc],
      [vc.clone(), va.clone(), kc, ka],
    ] as [THREE.Vector3, THREE.Vector3, string, string][]) {
      const key = ek(k1, k2);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { v1: p1, v2: p2, normals: [], front: [] });
      }
      const info = edgeMap.get(key)!;
      info.normals.push(normal.clone());
      info.front.push(isFront);
    }
  }

  const result: [THREE.Vector3, THREE.Vector3][] = [];

  for (const [, edge] of edgeMap) {
    const anyFront = edge.front.some(f => f);
    if (!anyFront) continue; // fully hidden — skip

    // Silhouette edge or boundary edge — always include
    const allFront = edge.front.every(f => f);
    if (!allFront || edge.normals.length < 2) {
      result.push([edge.v1, edge.v2]);
      continue;
    }

    // Interior edge: both faces front-facing — include only if sharp enough
    const dot = edge.normals[0].dot(edge.normals[1]);
    if (dot < cosThreshold) {
      result.push([edge.v1, edge.v2]);
    }
  }

  return result;
}

// ── Edge projection + chaining ────────────────────────────────────────────────

export function projectEdgesToPrimitives(
  meshGeometry: THREE.BufferGeometry,
  camera: THREE.Camera,
  canvasW: number,
  canvasH: number,
  thresholdAngle = 45,
): GeometryPrimitive[] {
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  // Get only visible edges (hidden-line removal)
  const visibleEdges = extractVisibleEdges(meshGeometry, camera, thresholdAngle);

  // Project to 2D screen coords
  type Pt = { x: number; y: number };
  const segments: [Pt, Pt][] = [];

  for (const [v1, v2] of visibleEdges) {
    const p1 = ndcToScreen(v1.clone().project(camera), canvasW, canvasH);
    const p2 = ndcToScreen(v2.clone().project(camera), canvasW, canvasH);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (Math.sqrt(dx * dx + dy * dy) < 1.0) continue; // skip degenerate
    segments.push([p1, p2]);
  }

  // Chain collinear adjacent segments into longer smooth strokes
  return chainSegments(segments, /* snapDist= */ 4, /* maxAngleDeg= */ 20);
}

// ── Edge chaining ─────────────────────────────────────────────────────────────

function chainSegments(
  segments: Array<[{ x: number; y: number }, { x: number; y: number }]>,
  snapDist: number,
  maxAngleDeg: number,
): GeometryPrimitive[] {
  if (segments.length === 0) return [];
  const maxAngleRad = maxAngleDeg * Math.PI / 180;

  type EndRef = { segIdx: number; isStart: boolean };
  const adj = new Map<string, EndRef[]>();
  const gridKey = (p: { x: number; y: number }) =>
    `${Math.round(p.x / snapDist)},${Math.round(p.y / snapDist)}`;

  for (let i = 0; i < segments.length; i++) {
    for (const isStart of [true, false]) {
      const p = isStart ? segments[i][0] : segments[i][1];
      const k = gridKey(p);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k)!.push({ segIdx: i, isStart });
    }
  }

  const used = new Set<number>();
  const chains: GeometryPrimitive[] = [];

  const ang = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.atan2(b.y - a.y, b.x - a.x);
  const angDiff = (a: number, b: number) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };

  const extendChain = (
    chain: { x: number; y: number }[],
    prepend: boolean,
  ) => {
    let extended = true;
    while (extended) {
      extended = false;
      const tip = prepend ? chain[0] : chain[chain.length - 1];
      const prev = prepend ? chain[1] : chain[chain.length - 2];
      if (!prev) break;
      const prevDir = ang(prev, tip);

      const neighbors = adj.get(gridKey(tip)) || [];
      for (const { segIdx, isStart } of neighbors) {
        if (used.has(segIdx)) continue;
        const [q1, q2] = segments[segIdx];
        const next = isStart ? q2 : q1;
        const nextDir = ang(tip, next);
        if (angDiff(prevDir, nextDir) < maxAngleRad) {
          if (prepend) chain.unshift(next); else chain.push(next);
          used.add(segIdx);
          extended = true;
          break;
        }
      }
    }
  };

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used.has(startIdx)) continue;
    used.add(startIdx);
    const [p1, p2] = segments[startIdx];
    const chain: { x: number; y: number }[] = [p1, p2];
    extendChain(chain, false);
    extendChain(chain, true);
    if (chain.length < 2) continue;
    let length = 0;
    for (let i = 1; i < chain.length; i++) {
      const dx = chain[i].x - chain[i - 1].x;
      const dy = chain[i].y - chain[i - 1].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    chains.push({ type: 'path', points: chain, length });
  }

  return chains;
}

function ndcToScreen(ndc: THREE.Vector3, W: number, H: number): { x: number; y: number } {
  return { x: ((ndc.x + 1) / 2) * W, y: ((1 - ndc.y) / 2) * H };
}
