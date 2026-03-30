// CadSketch renderer — draws the CAD-to-handwriting animation.
//
// Animation mechanism:
//   - Module-level Map tracks which elements are currently animating.
//   - hasActiveCadAnimations() is imported by InkCanvas to keep the rAF loop alive.
//   - Each render() call computes elapsed = Date.now() - animationStartTime and
//     draws only the portion of each stroke that should be visible so far.
//   - When elapsed >= totalDuration, the element is removed from the active set.
//
// Transform: we use transform.values[6,7] for tx/ty (same pattern as sketchableimage).
// Coordinates from parsers are in viewBox space; we scale to displayWidth/Height.

import type { CadSketchElement } from './types';
import type { BoundingBox } from '../../types/primitives';
import { colorToCSSRGBA } from '../../types/brush';

// ── Animation tracking ────────────────────────────────────────────────────────

// Maps element ID → the animationStartTime it was started with.
// Renderer adds entries when it first sees a started element,
// removes them when the animation completes.
const activeAnimations = new Map<string, number>();

/** Called by InkCanvas to decide whether to keep the rAF loop running. */
export function hasActiveCadAnimations(): boolean {
  return activeAnimations.size > 0;
}

// ── Render ────────────────────────────────────────────────────────────────────

export function render(
  ctx: CanvasRenderingContext2D,
  element: CadSketchElement,
  /* options not used — cadsketch controls its own transform */
): void {
  const { transform, displayWidth: W, displayHeight: H, viewBox: vb } = element;
  const tx = transform.values[6];
  const ty = transform.values[7];

  // Scale factors from viewBox coordinates to display coordinates
  const scaleX = vb.w > 0 ? W / vb.w : 1;
  const scaleY = vb.h > 0 ? H / vb.h : 1;

  // Compute elapsed animation time
  let elapsed = 0;
  if (element.animationStartTime > 0) {
    elapsed = Date.now() - element.animationStartTime;

    // Track / untrack this element in the active set
    if (!activeAnimations.has(element.id)) {
      activeAnimations.set(element.id, element.animationStartTime);
    }
    if (elapsed >= element.totalDuration) {
      activeAnimations.delete(element.id);
      elapsed = element.totalDuration; // clamp so we draw everything
    }
  }

  ctx.save();
  ctx.translate(tx, ty);

  // Paper background
  ctx.fillStyle = 'rgba(252, 250, 244, 0.97)';
  ctx.fillRect(0, 0, W, H);

  // Thin border
  ctx.strokeStyle = 'rgba(180, 170, 150, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Clip drawing to element bounds
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();

  // Draw each stroke up to the current animation time
  for (let i = 0; i < element.strokes.length; i++) {
    const strokeStart = element.strokeTimings[i];
    if (elapsed < strokeStart) continue; // stroke hasn't started yet

    const stroke = element.strokes[i];
    const inputs = stroke.inputs.inputs;
    if (inputs.length < 2) continue;

    const strokeElapsed = elapsed - strokeStart;
    const t0 = inputs[0].timeMillis;

    // Count visible points: those whose timeMillis offset ≤ elapsed within stroke
    let n = 0;
    while (n < inputs.length && inputs[n].timeMillis - t0 <= strokeElapsed) {
      n++;
    }
    if (n < 2) continue;

    ctx.beginPath();
    ctx.strokeStyle = colorToCSSRGBA(stroke.brush.color);
    ctx.lineWidth = stroke.brush.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Map from viewBox space to display space
    ctx.moveTo(
      (inputs[0].x - vb.x) * scaleX,
      (inputs[0].y - vb.y) * scaleY
    );
    for (let j = 1; j < n; j++) {
      ctx.lineTo(
        (inputs[j].x - vb.x) * scaleX,
        (inputs[j].y - vb.y) * scaleY
      );
    }
    ctx.stroke();
  }

  // Small filename label in bottom-left corner
  if (element.sourceFileName) {
    const label = element.sourceFileName.replace(/\.[^.]+$/, ''); // strip extension
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(150, 140, 120, 0.7)';
    ctx.fillText(label, 6, H - 5);
  }

  ctx.restore();
}

export function getBounds(element: CadSketchElement): BoundingBox | null {
  const tx = element.transform.values[6];
  const ty = element.transform.values[7];
  return {
    left: tx,
    top: ty,
    right: tx + element.displayWidth,
    bottom: ty + element.displayHeight,
  };
}
