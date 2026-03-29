// SVG Parser — converts SVG markup into geometry primitives for stroke animation.
//
// Key trick: we attach the SVG to the DOM and use browser-native
// SVGPathElement.getTotalLength() + getPointAtLength() to sample paths.
// This handles ALL path complexity (bezier curves, arcs, relative coords) for free.

export interface GeometryPrimitive {
  type: 'path';
  points: Array<{ x: number; y: number }>;
  length: number; // total path length in SVG units, used for drawing-order sort
}

export interface ParseResult {
  primitives: GeometryPrimitive[];
  viewBox: { x: number; y: number; w: number; h: number };
}

const SAMPLE_STEP_PX = 4; // sample a point every 4 SVG units along each path

export function parseSvg(svgString: string): ParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.warn('[SvgParser] SVG parse error:', parseError.textContent);
    return { primitives: [], viewBox: { x: 0, y: 0, w: 500, h: 500 } };
  }

  const svgEl = doc.querySelector('svg');
  if (!svgEl) return { primitives: [], viewBox: { x: 0, y: 0, w: 500, h: 500 } };

  // Parse viewBox attribute
  const vbAttr = svgEl.getAttribute('viewBox');
  let viewBox = { x: 0, y: 0, w: 500, h: 500 };
  if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.every(n => isFinite(n))) {
      viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  } else {
    // Fall back to width/height attributes
    const w = parseFloat(svgEl.getAttribute('width') ?? '500');
    const h = parseFloat(svgEl.getAttribute('height') ?? '500');
    if (isFinite(w) && isFinite(h)) viewBox = { x: 0, y: 0, w, h };
  }

  // Attach to DOM so SVG geometry APIs work
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;visibility:hidden;width:0;height:0;overflow:hidden';
  document.body.appendChild(container);
  container.appendChild(svgEl);

  const primitives: GeometryPrimitive[] = [];

  function samplePath(pathEl: SVGPathElement): void {
    try {
      const totalLength = pathEl.getTotalLength();
      if (totalLength < 2) return;

      const points: Array<{ x: number; y: number }> = [];
      for (let d = 0; d <= totalLength; d += SAMPLE_STEP_PX) {
        const pt = pathEl.getPointAtLength(d);
        points.push({ x: pt.x, y: pt.y });
      }
      // Always include the endpoint
      const endPt = pathEl.getPointAtLength(totalLength);
      points.push({ x: endPt.x, y: endPt.y });

      if (points.length >= 2) {
        primitives.push({ type: 'path', points, length: totalLength });
      }
    } catch (e) {
      // Some malformed paths throw — just skip
    }
  }

  function makePathEl(d: string): SVGPathElement {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svgEl.appendChild(p);
    return p;
  }

  // Process native <path> elements
  svgEl.querySelectorAll('path').forEach(el => samplePath(el as SVGPathElement));

  // Convert <line> → path
  svgEl.querySelectorAll('line').forEach(el => {
    const x1 = el.getAttribute('x1') ?? '0';
    const y1 = el.getAttribute('y1') ?? '0';
    const x2 = el.getAttribute('x2') ?? '0';
    const y2 = el.getAttribute('y2') ?? '0';
    samplePath(makePathEl(`M ${x1} ${y1} L ${x2} ${y2}`));
  });

  // Convert <rect> → path (perimeter)
  svgEl.querySelectorAll('rect').forEach(el => {
    const x = parseFloat(el.getAttribute('x') ?? '0');
    const y = parseFloat(el.getAttribute('y') ?? '0');
    const w = parseFloat(el.getAttribute('width') ?? '0');
    const h = parseFloat(el.getAttribute('height') ?? '0');
    const rx = parseFloat(el.getAttribute('rx') ?? '0');
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;
    if (rx > 0) {
      // Rounded rect as path
      samplePath(makePathEl(
        `M ${x + rx} ${y} L ${x + w - rx} ${y} ` +
        `A ${rx} ${rx} 0 0 1 ${x + w} ${y + rx} ` +
        `L ${x + w} ${y + h - rx} ` +
        `A ${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h} ` +
        `L ${x + rx} ${y + h} ` +
        `A ${rx} ${rx} 0 0 1 ${x} ${y + h - rx} ` +
        `L ${x} ${y + rx} ` +
        `A ${rx} ${rx} 0 0 1 ${x + rx} ${y} Z`
      ));
    } else {
      samplePath(makePathEl(`M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`));
    }
  });

  // Convert <circle> → path
  svgEl.querySelectorAll('circle').forEach(el => {
    const cx = parseFloat(el.getAttribute('cx') ?? '0');
    const cy = parseFloat(el.getAttribute('cy') ?? '0');
    const r = parseFloat(el.getAttribute('r') ?? '0');
    if (!isFinite(r) || r <= 0) return;
    // Two arcs forming a full circle
    samplePath(makePathEl(
      `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
    ));
  });

  // Convert <ellipse> → path
  svgEl.querySelectorAll('ellipse').forEach(el => {
    const cx = parseFloat(el.getAttribute('cx') ?? '0');
    const cy = parseFloat(el.getAttribute('cy') ?? '0');
    const rx = parseFloat(el.getAttribute('rx') ?? '0');
    const ry = parseFloat(el.getAttribute('ry') ?? '0');
    if (!isFinite(rx) || !isFinite(ry) || rx <= 0 || ry <= 0) return;
    samplePath(makePathEl(
      `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
    ));
  });

  // Convert <polyline> and <polygon> → path
  svgEl.querySelectorAll('polyline, polygon').forEach(el => {
    const pts = (el.getAttribute('points') ?? '').trim();
    if (!pts) return;
    const coords = pts.split(/[\s,]+/).map(Number).filter(n => isFinite(n));
    if (coords.length < 4) return;
    const pairs: string[] = [];
    for (let i = 0; i + 1 < coords.length; i += 2) {
      pairs.push(`${i === 0 ? 'M' : 'L'} ${coords[i]} ${coords[i + 1]}`);
    }
    if (el.tagName.toLowerCase() === 'polygon') pairs.push('Z');
    samplePath(makePathEl(pairs.join(' ')));
  });

  document.body.removeChild(container);

  return { primitives, viewBox };
}
