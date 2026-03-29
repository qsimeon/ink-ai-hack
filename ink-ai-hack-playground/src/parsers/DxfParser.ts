// DXF Parser — converts DXF (AutoCAD Drawing Exchange Format) text into geometry primitives.
//
// DXF is plain text structured as (group_code, value) line pairs.
// We handle: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE/VERTEX.
// These cover ~95% of mechanical 2D drawings.
//
// Group code reference:
//   0  = entity type name
//   10 = X1 (or center X for arc/circle)
//   20 = Y1 (or center Y for arc/circle)
//   11 = X2 (end point, LINE only)
//   21 = Y2 (end point, LINE only)
//   40 = radius (ARC, CIRCLE) or bulge factor (POLYLINE)
//   50 = start angle in degrees (ARC)
//   51 = end angle in degrees (ARC)
//   70 = flags (LWPOLYLINE: bit 1 = closed)
//   90 = vertex count (LWPOLYLINE)

import type { GeometryPrimitive, ParseResult } from './SvgParser';

const SAMPLE_STEP = 4; // units between sampled points

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function sampleLine(
  x1: number, y1: number, x2: number, y2: number
): Array<{ x: number; y: number }> {
  const d = dist(x1, y1, x2, y2);
  if (d < 0.001) return [{ x: x1, y: y1 }];
  const pts: Array<{ x: number; y: number }> = [];
  const steps = Math.max(1, Math.ceil(d / SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
  }
  return pts;
}

function sampleArc(
  cx: number, cy: number, r: number,
  startDeg: number, endDeg: number
): Array<{ x: number; y: number }> {
  if (r < 0.001) return [];
  let startRad = (startDeg * Math.PI) / 180;
  let endRad = (endDeg * Math.PI) / 180;
  // DXF arcs go counter-clockwise; if end <= start, it wraps around
  if (endRad <= startRad) endRad += 2 * Math.PI;
  const totalAngle = endRad - startRad;
  const arcLen = r * totalAngle;
  const steps = Math.max(2, Math.ceil(arcLen / SAMPLE_STEP));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const angle = startRad + (i / steps) * totalAngle;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function sampleCircle(cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  return sampleArc(cx, cy, r, 0, 360 - 0.001);
}

function arcLength(r: number, startDeg: number, endDeg: number): number {
  let diff = endDeg - startDeg;
  if (diff <= 0) diff += 360;
  return r * (diff * Math.PI) / 180;
}

export function parseDxf(text: string): ParseResult {
  // Normalize line endings and split into lines
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Read as (code, value) pairs
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (isFinite(code)) {
      pairs.push({ code, value });
    }
  }

  const primitives: GeometryPrimitive[] = [];
  let i = 0;

  // Advance until we find the ENTITIES section
  while (i < pairs.length && !(pairs[i].code === 2 && pairs[i].value.toUpperCase() === 'ENTITIES')) {
    i++;
  }

  while (i < pairs.length) {
    if (pairs[i].code !== 0) { i++; continue; }

    const entityType = pairs[i].value.toUpperCase();
    i++;

    if (entityType === 'ENDSEC' || entityType === 'EOF') break;

    if (entityType === 'LINE') {
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        if (code === 10) x1 = parseFloat(value);
        else if (code === 20) y1 = parseFloat(value);
        else if (code === 11) x2 = parseFloat(value);
        else if (code === 21) y2 = parseFloat(value);
        i++;
      }
      const pts = sampleLine(x1, y1, x2, y2);
      if (pts.length >= 2) {
        primitives.push({ type: 'path', points: pts, length: dist(x1, y1, x2, y2) });
      }
    }

    else if (entityType === 'ARC') {
      let cx = 0, cy = 0, r = 0, startAngle = 0, endAngle = 360;
      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        if (code === 10) cx = parseFloat(value);
        else if (code === 20) cy = parseFloat(value);
        else if (code === 40) r = parseFloat(value);
        else if (code === 50) startAngle = parseFloat(value);
        else if (code === 51) endAngle = parseFloat(value);
        i++;
      }
      const pts = sampleArc(cx, cy, r, startAngle, endAngle);
      if (pts.length >= 2) {
        primitives.push({ type: 'path', points: pts, length: arcLength(r, startAngle, endAngle) });
      }
    }

    else if (entityType === 'CIRCLE') {
      let cx = 0, cy = 0, r = 0;
      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        if (code === 10) cx = parseFloat(value);
        else if (code === 20) cy = parseFloat(value);
        else if (code === 40) r = parseFloat(value);
        i++;
      }
      const pts = sampleCircle(cx, cy, r);
      if (pts.length >= 2) {
        primitives.push({ type: 'path', points: pts, length: 2 * Math.PI * r });
      }
    }

    else if (entityType === 'LWPOLYLINE') {
      let closed = false;
      const vertices: Array<{ x: number; y: number }> = [];
      let vx = 0;
      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        if (code === 70) closed = (parseInt(value) & 1) === 1;
        else if (code === 10) vx = parseFloat(value);
        else if (code === 20) vertices.push({ x: vx, y: parseFloat(value) });
        i++;
      }
      if (closed && vertices.length > 0) vertices.push({ ...vertices[0] });
      if (vertices.length >= 2) {
        const pts = resamplePolyline(vertices);
        const len = polylineLength(vertices);
        if (pts.length >= 2) primitives.push({ type: 'path', points: pts, length: len });
      }
    }

    else if (entityType === 'POLYLINE') {
      // POLYLINE uses VERTEX sub-entities
      const vertices: Array<{ x: number; y: number }> = [];
      let closed = false;
      // Read POLYLINE flags
      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        if (code === 70) closed = (parseInt(value) & 1) === 1;
        i++;
      }
      // Read VERTEX entities
      while (i < pairs.length) {
        if (pairs[i].code !== 0) { i++; continue; }
        const sub = pairs[i].value.toUpperCase();
        if (sub === 'SEQEND') { i++; break; }
        if (sub !== 'VERTEX') break;
        i++;
        let vx = 0, vy = 0;
        while (i < pairs.length && pairs[i].code !== 0) {
          const { code, value } = pairs[i];
          if (code === 10) vx = parseFloat(value);
          else if (code === 20) vy = parseFloat(value);
          i++;
        }
        vertices.push({ x: vx, y: vy });
      }
      if (closed && vertices.length > 0) vertices.push({ ...vertices[0] });
      if (vertices.length >= 2) {
        const pts = resamplePolyline(vertices);
        const len = polylineLength(vertices);
        if (pts.length >= 2) primitives.push({ type: 'path', points: pts, length: len });
      }
    }

    else if (entityType === 'SPLINE') {
      // Collect control points and approximate as polyline
      const ctrlPts: Array<{ x: number; y: number }> = [];
      let cx = 0;
      while (i < pairs.length && pairs[i].code !== 0) {
        const { code, value } = pairs[i];
        if (code === 10) cx = parseFloat(value);
        else if (code === 20) ctrlPts.push({ x: cx, y: parseFloat(value) });
        i++;
      }
      if (ctrlPts.length >= 2) {
        const pts = resamplePolyline(ctrlPts);
        primitives.push({ type: 'path', points: pts, length: polylineLength(ctrlPts) });
      }
    }

    else {
      // Skip unknown entity — advance to next entity boundary
      while (i < pairs.length && pairs[i].code !== 0) i++;
    }
  }

  // Compute viewBox from all points
  const allPts = primitives.flatMap(p => p.points);
  if (allPts.length === 0) {
    return { primitives, viewBox: { x: 0, y: 0, w: 500, h: 500 } };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of allPts) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const pad = Math.max(5, (maxX - minX) * 0.03);
  return {
    primitives,
    viewBox: {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    },
  };
}

function resamplePolyline(
  vertices: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let j = 0; j < vertices.length - 1; j++) {
    const seg = sampleLine(vertices[j].x, vertices[j].y, vertices[j + 1].x, vertices[j + 1].y);
    // Avoid duplicating the shared endpoint between consecutive segments
    if (j > 0 && seg.length > 0) seg.shift();
    pts.push(...seg);
  }
  return pts;
}

function polylineLength(vertices: Array<{ x: number; y: number }>): number {
  let len = 0;
  for (let j = 0; j < vertices.length - 1; j++) {
    len += dist(vertices[j].x, vertices[j].y, vertices[j + 1].x, vertices[j + 1].y);
  }
  return len;
}
