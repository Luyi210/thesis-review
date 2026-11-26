import { OPS } from 'pdfjs-dist';
import type { PDFOperatorList } from 'pdfjs-dist/types/src/display/api';

export type Box = [number, number, number, number];
export interface PageMarks { horizontal: Box[]; vertical: Box[]; images: Box[]; vectorFigures?: Box[] }

const paintedPath = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
  OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

function findVectorFigures(shapes: Box[], connectors: Box[]): Box[] {
  // A standalone painted rectangle might be a text box, divider or border.
  // Look for two separate substantial shapes inside it instead.
  const figures = shapes.filter(frame => {
    const inside = shapes.filter(b => b[0] >= frame[0] + 3 && b[1] >= frame[1] + 3
      && b[2] <= frame[2] - 3 && b[3] <= frame[3] - 3);
    return inside.length >= 2 && (Math.max(...inside.map(b => b[0])) >= Math.min(...inside.map(b => b[2])) + 3
      || Math.max(...inside.map(b => b[1])) >= Math.min(...inside.map(b => b[3])) + 3);
  });

  // An unframed figure can still be supported by a straight connector touching
  // the facing sides of two disjoint shapes.
  for (const line of connectors) {
    const across = line[2] - line[0] > line[3] - line[1];
    const axis = across ? 0 : 1, other = 1 - axis;
    const middle = (line[other] + line[other + 2]) / 2;
    const touches = (b: Box, side: number, tip: number) =>
      Math.abs(b[side] - tip) <= 3 && middle >= b[other] && middle <= b[other + 2];
    const before = shapes.find(b => touches(b, axis + 2, line[axis]));
    const after = shapes.find(b => touches(b, axis, line[axis + 2]));
    if (!before || !after || before[axis + 2] >= after[axis]) continue;
    figures.push([Math.min(before[0], after[0]), Math.min(before[1], after[1]),
      Math.max(before[2], after[2]), Math.max(before[3], after[3])]);
  }
  return figures;
}

function concatenate(m: number[], n: number[]) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Read painted rules, images and supported figure geometry in the same viewport
// coordinates as text. Clipping-only paths and transparency groups are ignored.
export function pageMarks(ops: PDFOperatorList, viewportTransform: number[]): PageMarks {
  const marks: PageMarks = { horizontal: [], vertical: [], images: [] };
  const shapes: Box[] = [];
  const connectors: Box[] = [];
  let matrix = viewportTransform;
  const stack: number[][] = [];
  let groupDepth = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (op === OPS.beginGroup) { groupDepth++; continue; }
    if (op === OPS.endGroup) { groupDepth = Math.max(0, groupDepth - 1); continue; }
    if (groupDepth) continue;
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      stack.push(matrix);
      if (op === OPS.paintFormXObjectBegin && args?.[0]) matrix = concatenate(matrix, args[0]);
      continue;
    }
    if (op === OPS.restore || op === OPS.paintFormXObjectEnd) { matrix = stack.pop() ?? viewportTransform; continue; }
    if (op === OPS.transform) { matrix = concatenate(matrix, args); continue; }
    const image = op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject;
    const path = op === OPS.constructPath && paintedPath.has(args?.[0]);
    if ((!image && !path) || Math.abs(matrix[1]) > 0.001 || Math.abs(matrix[2]) > 0.001) continue;
    // PDF.js 5 exposes local path bounds for constructPath. Ignore operations without them.
    const bounds = image ? [0, 0, 1, 1] : args[2];
    if (!bounds || bounds.length !== 4 || !bounds.every(Number.isFinite)) continue;
    const x1 = matrix[0] * bounds[0] + matrix[4], x2 = matrix[0] * bounds[2] + matrix[4];
    const y1 = matrix[3] * bounds[1] + matrix[5], y2 = matrix[3] * bounds[3] + matrix[5];
    const box: Box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    const width = box[2] - box[0], height = box[3] - box[1];
    if (image && width >= 36 && height >= 24 && marks.images.length < 250) marks.images.push(box);
    if (!path) continue;
    // Preserve the existing evidence used by footnote separators and table grids.
    const rule = args[0] === OPS.stroke || args[0] === OPS.fill;
    if (rule && width >= 30 && height <= 1.5 && marks.horizontal.length < 1000) marks.horizontal.push(box);
    if (rule && height >= 15 && width <= 1.5 && marks.vertical.length < 1000) marks.vertical.push(box);
    if (width >= 18 && height >= 18 && shapes.length < 250) shapes.push(box);
    if (Math.min(width, height) <= 1.5 && Math.max(width, height) >= 12 && connectors.length < 250) connectors.push(box);
  }
  const figures = findVectorFigures(shapes, connectors);
  if (figures.length) marks.vectorFigures = figures;
  return marks;
}
