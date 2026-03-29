// CadSketch element plugin registration.
// No canCreate/createFromInk — elements are created via file upload in App.tsx.

import { registerPlugin } from '../registry';
import { render, getBounds } from './renderer';
import type { CadSketchElement } from './types';

registerPlugin<CadSketchElement>({
  elementType: 'cadsketch',
  name: 'CAD Sketch',
  render,
  getBounds,
});
