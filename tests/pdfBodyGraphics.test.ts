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
