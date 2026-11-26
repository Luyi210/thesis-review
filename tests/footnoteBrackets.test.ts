import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MarginNotes } from '../src/components/MarginNotes';
import { TeacherFeedbackProvider } from '../src/components/TeacherFeedback';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { marginAdvice } from '../src/domain/marginNotes';
import { auditDocument } from '../src/domain/rules';
import type { AuditDocument, Paragraph, RulePack } from '../src/domain/types';
import { markPageZones } from '../src/readers/pdfBodyZones';
import { paragraph } from '../src/readers/shared';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));

function pageRows(page: number, texts: string[], separator = true) {
  const rows = texts.map((text, index) => {
    const top = 720 + 15 * index;
    const row = paragraph(page * 10 + index, text);
    row.page = page;
    row.bbox = [58, top, 360, top + 9];
    row.runs = [{ text, font: null, size: 9, spacing: null, origin: 'PDF原生文字几何；字体名称未可靠还原' }];
    return row;
  });
  markPageZones(rows, { horizontal: separator ? [[58, 710, 188, 710]] : [], vertical: [], images: [] }, 600, 840);
  return rows;
}

function inspect(paragraphs: Paragraph[], limitations: AuditDocument['limitations'] = []) {
  const doc: AuditDocument = { format: 'pdf', name: 'footnotes.pdf', sha256: 'synthetic', bytes: 0,
    paragraphs, sections: [], objects: [], limitations };
  const report = auditDocument(doc, 'proposal', 'report', pack, DEFAULT_SETTINGS);
  const check = report.checks.find(entry => entry.rule.id === 'DOC-FOOTNOTE-BRACKETS')!;
  return { report, check };
}

it('adds the missing bracket without changing digits and anchors each correction to its original PDF line', () => {
  const pages = [
    ...pageRows(7, ['[26] 测点说明。']),
    ...pageRows(8, ['27] 样本来源。']),
    ...pageRows(17, ['[58] 第一组资料。']),
    ...pageRows(18, ['[59 第二组资料。', '[60 第三组资料。']),
    ...pageRows(19, ['[61 第四组资料。']),
    ...pageRows(20, ['[62] 第五组资料。']),
  ];
  const { report, check } = inspect(pages);
  expect(check.status).toBe('warning');
  expect(check.rule.source).toMatchObject({ kind: 'document' });
  expect(check.items.map(item => [item.location.page, item.observed, item.expected])).toEqual([
    [8, '27]', '[27]'], [18, '[59', '[59]'], [18, '[60', '[60]'], [19, '[61', '[61]'],
  ]);
  for (const item of check.items) {
    const original = pages.find(p => p.index === item.location.paragraph)!;
    expect(item.location.excerpt).toContain(item.observed);
    expect(item.location.bbox).toHaveLength(4);
    expect(original.page).toBe(item.location.page);
    expect(item.location.bbox![0]).toBeGreaterThanOrEqual(original.bbox![0]);
    expect(item.location.bbox![2]).toBeLessThanOrEqual(original.bbox![2]);
  }
  const first = check.items[0];
  expect(marginAdvice({ check, item: first, itemIndex: 0, status: first.status }, report)).toContain('[27]');
  const corrected = inspect([...pageRows(7, ['[26] 测点说明。']), ...pageRows(8, ['[27] 样本来源。'])]);
  expect(corrected.check.items).toEqual([]);
});

it('leaves body citations, intact reference ranges and ambiguous numbering alone', () => {
  const { check } = inspect([
    ...pageRows(1, ['[26] 有依据的脚注样式。']),
    ...pageRows(2, ['27] 正文列表可能使用另一种编号。', '参考文献', '[27 参考文献条目。'], false),
    ...pageRows(3, ['[26] 来源说明，详见文献 [27。', '[26–27] 资料范围。']),
    ...pageRows(26, ['[7] 来源材料，访问日期 [2024-10-0', '8]. https://example.org/record']),
  ]);
  expect(check.items).toEqual([]);
  expect(inspect(pageRows(8, ['27] 仅此一条，缺少同稿样式示例。'])).check.items).toEqual([]);
  expect(inspect([], [{ code: 'pdf-textless', message: '第 1 页仅有扫描图像。', affectsPresence: true, page: 1 }]).check.items).toEqual([]);
});

it('keeps a split access date in its original footnote and still detects a real missing left bracket', () => {
  const dates = [
    ['[7] Source, reviewed [2024-02-0', '8] https://example.org/synthetic'],
    ['［７］ 来源，访问日期［２０２４／１０／', '８］ 来源网址'],
  ];
  for (const texts of dates) {
    const { check } = inspect(pageRows(1, texts));
    expect(check.status).toBe('pass');
    expect(check.items).toEqual([]);
  }
  const { check } = inspect(pageRows(1, [
    '[7] Source, reviewed [2024-02-07]',
    '8] This note really lacks an opening bracket',
  ]));
  expect(check.items.map(item => [item.observed, item.expected])).toEqual([['8]', '[8]']]);
});

it('shows the original and corrected label as a document-based note with teacher feedback', () => {
  const { report, check } = inspect([...pageRows(7, ['[26] 测点说明。']), ...pageRows(8, ['27] 样本来源。'])]);
  const notes = createElement(MarginNotes, { report, selected: { id: check.rule.id, item: 0 },
    onSelect: () => {}, controls: { phase: 'ready', pendingKey: null, errors: {}, results: {},
      onExplain: () => {}, onConfigure: () => {}, onCancel: () => {} } });
  const html = renderToStaticMarkup(createElement(TeacherFeedbackProvider, { children: notes }));
  expect(html).toContain('27]');
  expect(html).toContain('[27]');
  expect(html).toContain('同稿');
  expect(html).toContain('教师反馈');
  expect(html).not.toContain('/rules/guide.pdf');
  expect(html).not.toContain('补充解释');
});
