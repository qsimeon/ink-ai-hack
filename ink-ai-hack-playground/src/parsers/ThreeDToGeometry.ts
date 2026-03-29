// ThreeDToGeometry — loads 3D files (STL, OBJ) and produces 2D geometry
// primitives for the CAD sketch animation pipeline.
//
// Key insight: STL meshes have thousands of tessellation triangle edges.
// Using EdgesGeometry at a low threshold produces hundreds of overlapping
// 2-point segments that stack into dark blobs.
//
// Solution: after projecting edges to 2D, CHAIN adjacent collinear segments
// into single long paths (like a human would draw one smooth stroke).
// A 60-segment tessellated circle becomes a single circular stroke.

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

// ── Edge projection + chaining ────────────────────────────────────────────────
//
// 1. Extract feature edges at a high threshold (45°) to skip tessellation noise
// 2. Project each 3D edge vertex through the camera to 2D canvas coords
// 3. Chain adjacent collinear edge segments into longer continuous paths
//    — this is the key step that turns "1000 tiny wiggles" into "20 smooth strokes"

export function projectEdgesToPrimitives(
  meshGeometry: THREE.BufferGeometry,
  camera: THREE.Camera,
  canvasW: number,
  canvasH: number,
  thresholdAngle = 45,   // degrees — higher = fewer edges, only hard corners
): GeometryPrimitive[] {
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  const edgesGeom = new THREE.EdgesGeometry(meshGeometry, thresholdAngle);
  const positions = edgesGeom.attributes.position;
  if (!positions) { edgesGeom.dispose(); return []; }

  // Step 1: project all edge segments to 2D
  type Pt = { x: number; y: number };
  const segments: [Pt, Pt][] = [];

  for (let i = 0; i < positions.count; i += 2) {
    const v1 = new THREE.Vector3().fromBufferAttribute(positions, i);
    const v2 = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
    const p1 = ndcToScreen(v1.project(camera), canvasW, canvasH);
    const p2 = ndcToScreen(v2.project(camera), canvasW, canvasH);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (Math.sqrt(dx*dx + dy*dy) < 1.0) continue; // skip degenerate edges
    segments.push([p1, p2]);
  }

  edgesGeom.dispose();

  // Step 2: chain collinear adjacent segments into longer paths
  return chainSegments(segments, /* snapDist= */ 4, /* maxAngleDeg= */ 20);
}

// ── Edge chaining ─────────────────────────────────────────────────────────────
//
// Groups adjacent collinear 2D segments into longer ordered paths.
// E.g. 60 tiny segments around a cylinder → 1 circular stroke.
//
// snapDist:   max pixel distance between endpoints to consider "connected"
// maxAngleDeg: max direction change between consecutive segments to chain them

function chainSegments(
  segments: Array<[{x:number;y:number},{x:number;y:number}]>,
  snapDist: number,
  maxAngleDeg: number,
): GeometryPrimitive[] {
  if (segments.length === 0) return [];
  const maxAngleRad = maxAngleDeg * Math.PI / 180;

  // Build adjacency map: grid-snapped endpoint → list of (segIdx, isStart)
  type EndRef = { segIdx: number; isStart: boolean };
  const adj = new Map<string, EndRef[]>();
  const gridKey = (p: {x:number;y:number}) =>
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

  const ang = (a: {x:number;y:number}, b: {x:number;y:number}) =>
    Math.atan2(b.y - a.y, b.x - a.x);
  const angDiff = (a: number, b: number) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };

  const extendChain = (
    chain: {x:number;y:number}[],
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
        // next point after connecting through `tip`
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
    const chain: {x:number;y:number}[] = [p1, p2];
    extendChain(chain, false);  // extend forward from p2
    extendChain(chain, true);   // extend backward from p1
    if (chain.length < 2) continue;
    let length = 0;
    for (let i = 1; i < chain.length; i++) {
      const dx = chain[i].x - chain[i-1].x;
      const dy = chain[i].y - chain[i-1].y;
      length += Math.sqrt(dx*dx + dy*dy);
    }
    chains.push({ type: 'path', points: chain, length });
  }

  return chains;
}

function ndcToScreen(ndc: THREE.Vector3, W: number, H: number): { x: number; y: number } {
  return { x: ((ndc.x + 1) / 2) * W, y: ((1 - ndc.y) / 2) * H };
}
