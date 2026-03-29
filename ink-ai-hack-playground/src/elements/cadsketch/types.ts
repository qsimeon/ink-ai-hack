// CadSketchElement — animates a parsed CAD drawing as if being sketched by hand.
//
// The element stores all strokes up-front (converted from SVG/DXF geometry).
// The renderer reads animationStartTime to determine which portion to draw,
// creating the effect of a hand drawing the part stroke-by-stroke.

import type { TransformableElement } from '../../types/primitives';
import { createTranslationMatrix, generateId } from '../../types/primitives';
import type { Stroke } from '../../types/brush';

export interface CadSketchElement extends TransformableElement {
  type: 'cadsketch';
  sourceFileName: string;
  strokes: Stroke[];
  strokeTimings: number[];    // ms offset from animationStartTime when each stroke begins
  totalDuration: number;      // total animation length in ms
  animationStartTime: number; // Date.now() when animation started (0 = not yet started)
  viewBox: { x: number; y: number; w: number; h: number };
  displayWidth: number;       // rendered width on canvas in canvas units
  displayHeight: number;      // rendered height on canvas in canvas units
}

export interface CreateCadSketchData {
  strokes: Stroke[];
  strokeTimings: number[];
  totalDuration: number;
  viewBox: { x: number; y: number; w: number; h: number };
  sourceFileName: string;
  displayWidth?: number;
}

export function createCadSketchElement(
  canvasX: number,
  canvasY: number,
  data: CreateCadSketchData
): CadSketchElement {
  const W = data.displayWidth ?? 400;
  // Maintain aspect ratio from viewBox
  const aspect = data.viewBox.h > 0 && data.viewBox.w > 0
    ? data.viewBox.h / data.viewBox.w
    : 1;
  const H = W * aspect;

  return {
    id: generateId(),
    type: 'cadsketch',
    // Center the element at the given canvas position
    transform: createTranslationMatrix(canvasX - W / 2, canvasY - H / 2),
    sourceFileName: data.sourceFileName,
    strokes: data.strokes,
    strokeTimings: data.strokeTimings,
    totalDuration: data.totalDuration,
    animationStartTime: 0,
    viewBox: data.viewBox,
    displayWidth: W,
    displayHeight: H,
  };
}
