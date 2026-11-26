import { expect, it, vi } from 'vitest';
import { OPS } from 'pdfjs-dist';
import type { PDFOperatorList } from 'pdfjs-dist/types/src/display/api';
import { pageMarks } from '../src/readers/pdfGraphics';

vi.mock('pdfjs-dist', async () => ({ OPS: (await import('pdfjs-dist/legacy/build/pdf.mjs')).OPS }));

it('uses the viewport and form transforms for painted rules and images, excluding clipping paths', () => {
  const sequence = [
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 20, 40]]],
    [OPS.constructPath, [OPS.stroke, [], [5, 8, 175, 8]]],
    [OPS.constructPath, [OPS.stroke, [], [5, 8, 5, 62]]],
    [OPS.constructPath, [OPS.endPath, [], [5, 9, 175, 9]]],
    [OPS.paintFormXObjectEnd, []],
    [OPS.save, []],
    [OPS.transform, [100, 0, 0, 60, 180, 210]],
    [OPS.paintImageXObject, []],
    [OPS.restore, []],
    [OPS.constructPath, [OPS.stroke, [], [40, 70, 110, 70]]],
  ] as const;
  const operators = { fnArray: sequence.map(pair => pair[0]), argsArray: sequence.map(pair => pair[1]) } as PDFOperatorList;
  expect(pageMarks(operators, [1, 0, 0, -1, 0, 800])).toEqual({
    horizontal: [[25, 752, 195, 752], [40, 730, 110, 730]],
    vertical: [[25, 698, 25, 752]], images: [[180, 530, 280, 590]],
  });
});

it('requires multiple shapes for framed figures or a connector for a pair of unframed shapes', () => {
  const paint = [
    [OPS.fillStroke, [100, 200, 500, 315]],
    [OPS.fillStroke, [130, 220, 240, 290]],
    [OPS.fillStroke, [360, 220, 470, 290]],
    [OPS.closeFillStroke, [140, 410, 255, 465]],
    [OPS.closeFillStroke, [315, 410, 430, 465]],
    [OPS.stroke, [255, 438, 315, 438]],
    [OPS.fillStroke, [100, 605, 230, 650]],
    [OPS.fillStroke, [100, 690, 230, 735]],
    [OPS.stroke, [165, 650, 165, 690]],
    [OPS.stroke, [80, 30, 500, 150]],
    [OPS.endPath, [125, 54, 250, 124]],
  ] as const;
  const ops: PDFOperatorList = {
    fnArray: paint.map(() => OPS.constructPath),
    argsArray: paint.map(([action, box]) => [action, [], box]),
  };
  const marks = pageMarks(ops, [1, 0, 0, -1, 0, 800]);
  expect(marks.vectorFigures).toEqual([[100, 485, 500, 600], [140, 335, 430, 390], [100, 65, 230, 195]]);
});
