import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readPdf } from '../src/readers/pdf';
import { auditDocument } from '../src/domain/rules';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { buildMarginPositions, inspectMarginSelection } from '../src/domain/marginNotes';
import { groupPdfMarks, sourceMarks, pdfBoundsKey, preferredMark } from '../src/components/documentMarks';
import { MarginNotes } from '../src/components/MarginNotes';

// Use PDF.js's Node-compatible build with the same packed fonts as the browser.
vi.mock('pdfjs-dist', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return {
    OPS: pdfjs.OPS,
    GlobalWorkerOptions: {},
    getDocument: (options: { data: Uint8Array }) => pdfjs.getDocument({
      ...options,
      cMapUrl: resolve('public/pdf-assets/cmaps') + '/',
      standardFontDataUrl: resolve('public/pdf-assets/standard_fonts') + '/',
      wasmUrl: resolve('public/pdf-assets/wasm') + '/',
    }),
  };
});

const bytes = await readFile('public/samples/native-pdf.pdf');
const pack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const doc = await readPdf(Uint8Array.from(bytes).buffer, 'native-pdf.pdf', pack);
const report = auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);

it('reproduces the previously captured size and coordinates of the synthetic PDF line', async () => {
  const fixture = JSON.parse(await readFile('tests/fixtures/native-pdf-line.json', 'utf8'));
  expect(doc.sha256).toBe(fixture.sha256);
  const line = doc.paragraphs.find(p => p.index === fixture.paragraph)!;
  expect(line.text).toBe(fixture.excerpt);
  expect(line.page).toBe(fixture.page);
  expect(line.runs[0].size).toBeCloseTo(fixture.size);
  expect(line.bbox).toHaveLength(4);
  fixture.bbox.forEach((value: number, i: number) => expect(line.bbox![i]).toBeCloseTo(value));
  const html = renderToStaticMarkup(createElement(MarginNotes, {
    report, selected: { id: 'FMT-SIZE', item: 0 }, onSelect: () => {},
  }));
  expect(html).toContain('10.5 磅');
  expect(html).toContain('先核实这行是否属于正文');
});

it('links the real PDF sample line to its own size candidate and college reference', () => {
  const line = doc.paragraphs.find(p => p.text.includes('专门用于核对字号和问题定位'))!;
  expect(line?.page).toBe(1);
  const box = pdfBoundsKey(line)!;
  const group = groupPdfMarks(sourceMarks(report.checks), 1).get(box)!;
  const selection = preferredMark(group, null);
  expect(selection.id).toBe('FMT-SIZE');
  const entries = buildMarginPositions(report);
  const note = inspectMarginSelection(report, entries, selection)!;
  expect(note.location?.paragraph).toBe(line.index);
  expect(note.location?.bbox).toEqual(line.bbox);
  const html = renderToStaticMarkup(createElement(MarginNotes, { report, selected: selection, onSelect: () => {} }));
  expect(html).toContain('建议调整');
  expect(html).toContain('/rules/guide.pdf#page=6');
  expect(html).toContain('Word 或 WPS');
  expect(html).not.toContain('明确不符');
});
