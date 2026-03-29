// GeometryToStrokes — converts parsed geometry primitives into ink.ai Stroke objects
// with animation timing, so the drawing can replay stroke-by-stroke.
//
// Drawing order: longest paths (outer contours) first, then shorter details.
// This mirrors how a drafter would draw: big shapes first, then details.
//
// Jitter: small random noise added to each point to make lines look hand-drawn.

import { StockBrush, InkToolType } from '../types/brush';
import type { Stroke } from '../types/brush';
import type { GeometryPrimitive } from './SvgParser';

export interface StrokeConversionOptions {
  jitter?: number;      // px of random noise per point, default 1.5
  msPerPoint?: number;  // animation speed: ms per sampled point, default 12
  penUpMs?: number;     // pause between strokes (pen-up), default 100ms
  color?: number;       // ARGB packed int, default 0xff1a1a2e (dark navy ink)
  brushSize?: number;   // brush diameter, default 2
}

export interface StrokeConversionResult {
  strokes: Stroke[];
  timings: number[];    // strokeTimings[i] = ms offset when strokes[i] starts drawing
  totalDuration: number;
}

export function geometryToStrokes(
  primitives: GeometryPrimitive[],
  options: StrokeConversionOptions = {}
): StrokeConversionResult {
  const {
    jitter = 1.5,
    msPerPoint = 12,
    penUpMs = 100,
    color = 0xff1a1a2e,
    brushSize = 2,
  } = options;

  // Sort: longest paths first (outer contours / major features)
  const sorted = [...primitives].sort((a, b) => b.length - a.length);

  const strokes: Stroke[] = [];
  const timings: number[] = [];
  let offset = 0;

  for (const prim of sorted) {
    const { points } = prim;
    if (points.length < 2) continue;

    // Apply jitter to simulate hand tremor
    const inputs = points.map((p, idx) => ({
      x: p.x + (Math.random() - 0.5) * jitter * 2,
      y: p.y + (Math.random() - 0.5) * jitter * 2,
      // timeMillis starts at offset and increments per point
      timeMillis: offset + idx * msPerPoint,
    }));

    strokes.push({
      inputs: {
        tool: InkToolType.STYLUS,
        inputs,
      },
      brush: {
        stockBrush: StockBrush.BALLPOINT,
        color,
        size: brushSize,
      },
    });

    timings.push(offset);
    // Advance time by stroke duration + pen-up gap
    offset += points.length * msPerPoint + penUpMs;
  }

  return { strokes, timings, totalDuration: offset };
}
