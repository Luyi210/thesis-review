import { OPS } from 'pdfjs-dist';
import type { PDFOperatorList } from 'pdfjs-dist/types/src/display/api';

export type Box = [number, number, number, number];
export interface PageMarks { horizontal: Box[]; vertical: Box[]; images: Box[] }

function concatenate(m: number[], n: number[]) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Read simple painted rules and images in the same viewport coordinates as text.
// Compound paths, clipping boxes and transparency groups provide no positive evidence.
export function pageMarks(ops: PDFOperatorList, viewportTransform: number[]): PageMarks {
  const marks: PageMarks = { horizontal: [], vertical: [], images: [] };
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
    const path = op === OPS.constructPath && (args[0] === OPS.stroke || args[0] === OPS.fill);
    if ((!image && !path) || Math.abs(matrix[1]) > 0.001 || Math.abs(matrix[2]) > 0.001) continue;
    // PDF.js 5 exposes local path bounds for constructPath. Ignore operations without them.
    const bounds = image ? [0, 0, 1, 1] : args[2];
    if (!bounds || bounds.length !== 4) continue;
    const x1 = matrix[0] * bounds[0] + matrix[4], x2 = matrix[0] * bounds[2] + matrix[4];
    const y1 = matrix[3] * bounds[1] + matrix[5], y2 = matrix[3] * bounds[3] + matrix[5];
    const box: Box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    const width = box[2] - box[0], height = box[3] - box[1];
    if (image && width >= 36 && height >= 24 && marks.images.length < 250) marks.images.push(box);
    if (path && width >= 30 && height <= 1.5 && marks.horizontal.length < 1000) marks.horizontal.push(box);
    if (path && height >= 15 && width <= 1.5 && marks.vertical.length < 1000) marks.vertical.push(box);
  }
  return marks;
}
