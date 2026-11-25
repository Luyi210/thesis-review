import { readFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { auditDocument } from '../src/domain/rules';
import type { AuditDocument, Paragraph, RulePack } from '../src/domain/types';
import { readDocx } from '../src/readers/docx';
import { headingInfo, headingNames, paragraph } from '../src/readers/shared';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const names = headingNames(pack);

function line(index: number, text: string, extra: Partial<Paragraph> = {}): Paragraph {
  const [heading, level] = headingInfo(text, names);
  return { ...paragraph(index, text), heading, level, ...extra };
}
function check(doc: AuditDocument, id: string) {
  return auditDocument(doc, 'proposal', 'report', pack, DEFAULT_SETTINGS).checks.find(entry => entry.rule.id === id)!;
}
function pdf(paragraphs: Paragraph[]): AuditDocument {
  return { format: 'pdf', name: 'synthetic.pdf', sha256: 'synthetic', bytes: 0, paragraphs,
    sections: [], objects: [], limitations: [] };
}

it('finds review, outline and schedule in ordinary Word headings and keeps the original wording', async () => {
  const sections = ['第二章 研究综述', '既有成果概况。', '（一）学位论文框架', '拟分六章逐章说明。',
    '预期成果及时间安排', '每月安排一次工具检查。'];
  const content = sections.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}</w:body></w:document>`;
  const buffer = zipSync({ 'word/document.xml': strToU8(xml) });
  const doc = await readDocx(Uint8Array.from(buffer).buffer, 'synthetic.docx', pack);
  for (const [index, id] of ['PROP-REVIEW', 'PROP-OUTLINE', 'PROP-SCHEDULE'].entries()) {
    const result = check(doc, id);
    expect(result.status).toBe('pass');
    expect(result.items).toMatchObject([{ observed: sections[2 * index], location: { paragraph: 2 * index + 1 } }]);
  }
});

it('returns only the operative title on the PDF page even when similar words occur elsewhere', () => {
  const doc = pdf([
    line(1, '论文框架', { page: 1, toc: true }),
    line(2, '论文框架', { page: 2, excluded: true }),
    line(3, '论文框架', { page: 2, inTable: true }),
    line(4, '论文框架', { page: 3, caption: true }),
    line(5, '这里提到了论文框架。', { page: 4 }),
    line(6, '论文框架。', { page: 4 }),
    line(7, '第三节 论文框架', { page: 5, bbox: [80, 300, 170, 316] }),
    line(8, '拟列出各章的研究主题。', { page: 5 }),
  ]);
  expect(check(doc, 'PROP-OUTLINE').items).toMatchObject([{ observed: '第三节 论文框架',
    status: 'pass', location: { paragraph: 7, page: 5, bbox: [80, 300, 170, 316] } }]);
});

it('requires section content beyond nested headings, footer text and captions', () => {
  const doc = pdf([line(1, '第一章 研究综述'), line(2, '第一节 概述'),
    line(3, '附注。', { excluded: true }), line(4, '附图题名', { caption: true }),
    line(5, '第二章 方法'), line(6, '本节有内容。')]);
  expect(check(doc, 'PROP-REVIEW')).toMatchObject({ status: 'manual', items: [{ status: 'manual', location: { paragraph: 1 } }] });
});

it('accepts a schedule supplied as table text within a matching combined section', () => {
  const doc = pdf([line(1, '第三章 研究可行性和进度安排'), line(2, '五月至六月完成访谈', { inTable: true, heading: true, level: 1 })]);
  expect(check(doc, 'PROP-SCHEDULE')).toMatchObject({ status: 'pass', items: [{ location: { paragraph: 1 }, status: 'pass' }] });
});

it('keeps a prose mention or a differently scoped chapter title out of the results', () => {
  const doc = pdf([line(1, '第三章 对既有论文框架的评价'), line(2, '本章还将交代时间安排。'),
    line(3, '第四章 课堂时间安排'), line(4, '本节是课堂活动用时。')]);
  for (const id of ['PROP-OUTLINE', 'PROP-SCHEDULE']) expect(check(doc, id)).toMatchObject({ status: 'manual', items: [] });
});
