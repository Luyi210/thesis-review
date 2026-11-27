import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarginNotes } from '../src/components/MarginNotes';
import { spanOffsets, wordRunOffsets } from '../src/components/wordRanges';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { marginInitialSelection } from '../src/domain/marginNotes';
import { auditDocument } from '../src/domain/rules';
import { readDocx } from '../src/readers/docx';
import type { RulePack } from '../src/domain/types';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const file = await readFile('public/samples/mixed-run-format.docx');
const doc = await readDocx(Uint8Array.from(file).buffer, '同段不同字号.docx', pack);
const report = auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
const sizeCheck = report.checks.find(c => c.rule.id === 'FMT-SIZE')!;
const paragraph = doc.paragraphs.find(p => p.index === 22)!;

describe('public mixed-size sample', () => {
  it('finds the two separate phrases without marking intervening 12-point text', () => {
    const offsets = wordRunOffsets(paragraph, paragraph.text)!;
    expect(sizeCheck.items).toHaveLength(2);
    expect(sizeCheck.items.map(item => {
      const [start, end] = spanOffsets(offsets, item.formatSpan!)!;
      return [item.location.paragraph, paragraph.text.slice(start, end), item.observed, item.expected];
    })).toEqual([[22, '输入电压', '10.5', '12 磅'], [22, '输出电压', '14', '12 磅']]);
    expect(wordRunOffsets(paragraph, '预览文字有差异')).toBeNull();
  });
  it('opens the selected occurrence and lists the other as a separate choice', () => {
    const html = renderToStaticMarkup(createElement(MarginNotes, {
      report, selected: { id: sizeCheck.rule.id, item: 1 }, onSelect: () => {},
    }));
    const [active, related] = html.split('aria-label="同一位置的其他批注"');
    expect(active).toContain('14 磅');
    expect(active).toContain('输出电压');
    expect(active).not.toContain('输入电压');
    expect(related).toContain('输入电压');
  });
});

it('runs the complete demonstration through the normal thesis rules', async () => {
  const demo = await readFile('public/samples/thesis-review-demo.docx');
  const document = await readDocx(Uint8Array.from(demo).buffer, '完整演示稿.docx', pack);
  const checked = auditDocument(document, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
  const byId = new Map(checked.checks.map(check => [check.rule.id, check]));
  const first = marginInitialSelection(checked);
  expect(first?.id).toBe('FMT-SIZE');
  expect(byId.get('FMT-SIZE')?.items[first!.item]).toMatchObject({
    observed: '10.5',
    expected: '12 磅',
    formatSpan: { text: '座位供给的分时分布' },
  });
  for (const [id, count] of Object.entries({
    'FMT-A4': 1, 'FMT-FONT': 1, 'FMT-SIZE': 3, 'FMT-LINE': 1, 'FMT-SPACING': 1,
    'CAPTION-POSITION': 2, 'CAPTION-NUMBER': 2,
  })) {
    expect(byId.get(id)?.items.filter(item => item.status === 'fail'), id).toHaveLength(count);
  }
});
