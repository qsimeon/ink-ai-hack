// CadViewer3D — modal 3D viewer for STL/OBJ files.
//
// Rendering: shaded mesh (MeshStandardMaterial + lights) so the model looks
// like the blog-rsLSM viewer, not a flat wireframe.
//
// Interaction: OrbitControls for rotation/zoom so the user can pick any angle,
// then click "Sketch This View" to animate it on the canvas.
//
// Sketch extraction: EdgesGeometry at 45° + edge chaining turns many tiny
// tessellation segments into a small set of long smooth strokes.

import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GeometryPrimitive } from '../parsers/SvgParser';
import { projectEdgesToPrimitives } from '../parsers/ThreeDToGeometry';

const VIEWER_SIZE = 400;

interface CadViewer3DProps {
  geometry: THREE.BufferGeometry;
  fileName: string;
  onSketch: (primitives: GeometryPrimitive[]) => void;
  onClose: () => void;
}

export default function CadViewer3D({ geometry, fileName, onSketch, onClose }: CadViewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // ── Bounding sphere ───────────────────────────────────────────────────────
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    const center = sphere.center.clone();
    const radius = Math.max(sphere.radius, 0.001);

    // ── Isometric orthographic camera ─────────────────────────────────────────
    const halfSize = radius * 1.4;
    const camera = new THREE.OrthographicCamera(
      -halfSize, halfSize, halfSize, -halfSize, 0.01, radius * 30
    );
    const isoDir = new THREE.Vector3(1, 1, 1).normalize();
    camera.position.copy(center).addScaledVector(isoDir, radius * 5);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    cameraRef.current = camera;

    // ── Scene ─────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d1a);

    // Shaded mesh — looks 3D instead of flat wireframe
    const meshMat = new THREE.MeshStandardMaterial({
      color: 0xc8d8e8,
      metalness: 0.15,
      roughness: 0.65,
      side: THREE.FrontSide,
    });
    const shadedMesh = new THREE.Mesh(geometry, meshMat);
    scene.add(shadedMesh);

    // Edge overlay — thin lines on top for the engineering-drawing look
    const edgesGeom = new THREE.EdgesGeometry(geometry, 20);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x1a3a5a, linewidth: 1 });
    scene.add(new THREE.LineSegments(edgesGeom, edgeMat));

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 1.5).normalize();
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6090c0, 0.4);
    fill.position.set(-1, -0.5, -1).normalize();
    scene.add(fill);

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(VIEWER_SIZE, VIEWER_SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    const container = containerRef.current;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── OrbitControls ─────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    // ── Render loop ───────────────────────────────────────────────────────────
    let alive = true;
    const animate = () => {
      if (!alive) return;
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      alive = false;
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      meshMat.dispose();
      edgesGeom.dispose();
      edgeMat.dispose();
      renderer.dispose();
      if (container?.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [geometry]);

  const handleSketchThisView = useCallback(() => {
    if (!cameraRef.current) return;
    cameraRef.current.updateMatrixWorld(true);
    cameraRef.current.matrixWorldInverse.copy(cameraRef.current.matrixWorld).invert();
    const primitives = projectEdgesToPrimitives(
      geometry,
      cameraRef.current,
      VIEWER_SIZE,
      VIEWER_SIZE,
    );
    if (primitives.length === 0) {
      console.warn('[CadViewer3D] No edges found to sketch');
      return;
    }
    onSketch(primitives);
  }, [geometry, onSketch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayName = fileName.replace(/\.[^.]+$/, '');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
      }}
      onPointerDown={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#12121f', borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', userSelect: 'none',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ color: '#90caf9', fontSize: 13, fontFamily: 'monospace', fontWeight: 600 }}>
            {displayName}
          </span>
          <button onClick={onClose} title="Close (Esc)"
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>
            ×
          </button>
        </div>

        {/* Viewport */}
        <div ref={containerRef} style={{ width: VIEWER_SIZE, height: VIEWER_SIZE }} />

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', gap: 12,
        }}>
          <span style={{ color: '#555', fontSize: 11 }}>
            Drag to rotate · Scroll to zoom
          </span>
          <button onClick={handleSketchThisView}
            style={{
              background: '#0d47a1', color: '#e3f2fd', border: '1px solid #1565c0',
              borderRadius: 6, padding: '7px 16px', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
            ✏ Sketch This View
          </button>
        </div>
      </div>
    </div>
  );
}
