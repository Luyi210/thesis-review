import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { auditDocument } from '../src/domain/rules';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { paragraph } from '../src/readers/shared';
import type { AuditDocument, RulePack } from '../src/domain/types';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
function sample(keywords = '关键词：实验教学；学习反馈；课堂观察', abstract = '文'.repeat(350)): AuditDocument {
  const texts = ['摘要', abstract, keywords, '中图分类号：G633.7', 'ABSTRACT', 'English abstract.', 'CLC: G633.7', '第一章 绪论', '普通正文'];
  const paragraphs = texts.map((text, i) => ({ ...paragraph(i + 1, text), heading: [0, 4, 7].includes(i), level: [0, 4, 7].includes(i) ? 1 : null }));
  return { name: 'synthetic.docx', format: 'docx', sha256: 'synthetic', bytes: 0, paragraphs, sections: [], objects: [], limitations: [] };
}
function check(doc: AuditDocument, id: string) { return auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS).checks.find(c => c.rule.id === id)!; }
it('counts clear keywords and keeps academic quality outside this check', () => {
  const c = check(sample(), 'KEYWORDS'); expect(c.status).toBe('pass'); expect(c.items[0].observed).toContain('3个'); expect(c.summary).toContain('只核对数量');
});
it.each(['关键词：实验教学；学习反馈', '关键词：甲；乙；丙；丁；戊；己'])('finds an explicit keyword count deviation: %s', keywords => { const c = check(sample(keywords), 'KEYWORDS'); expect(c.status).toBe('fail'); expect(c.items[0].location.paragraph).toBe(3); });
it.each(['关键词：实验教学 学习反馈', '关键词：教学，反馈', '关键词：教学；反馈；', '关键词：教学；教学；反馈', '关键词：教学；反馈\n课堂观察', '关键词：教学；反馈；中图分类号：G64'])('keeps ambiguous keyword boundaries manual: %s', keywords => { expect(check(sample(keywords), 'KEYWORDS').status).toBe('manual'); });
it('does not hard-fail abstract length and documents the count policy', () => {
  const c = check(sample(undefined, '文'.repeat(250)), 'ABS-LENGTH'); expect(c.status).toBe('warning'); expect(c.summary).toContain('250个文字单位'); expect(c.summary).toContain('不等同Word字数');
  expect(check(sample(), 'ABS-LENGTH').status).toBe('pass');
});
it('does not include the keyword line or classification number in abstract length', () => { expect(check(sample(), 'ABS-LENGTH').summary).toContain('350个文字单位'); });
it('checks both classification locations without prescribing the example G64', () => {
  const d = sample(); expect(check(d, 'CLASSIFICATION').status).toBe('pass');
  d.paragraphs[6].text = 'Classification unavailable'; const c = check(d, 'CLASSIFICATION'); expect(c.status).toBe('manual'); expect(c.summary).toContain('英文摘要'); expect(c.items).toHaveLength(1);
});
it.each(['image', 'revision', 'unbounded', 'duplicate-heading', 'table', 'pdf'])('keeps uncertain abstract coverage manual: %s', mode => {
  const d = sample();
  if (mode === 'image' || mode === 'revision') d.limitations.push({ code: mode, message: 'not covered', affectsPresence: true });
  if (mode === 'unbounded') d.paragraphs = d.paragraphs.slice(0, 4);
  if (mode === 'duplicate-heading') d.paragraphs.push({ ...paragraph(10, '摘要'), heading: true, level: 1 });
  if (mode === 'table') d.paragraphs[1].inTable = true;
  if (mode === 'pdf') d.format = 'pdf';
  expect(check(d, 'ABS-LENGTH').status).toBe('manual'); expect(check(d, 'KEYWORDS').status).toBe('manual');
});
it('does not count TOC copies as a second abstract', () => {
  const d = sample(); d.paragraphs.unshift({ ...paragraph(0, '摘要'), heading: true, level: 1, toc: true }); expect(check(d, 'ABS-LENGTH').status).toBe('pass');
});
it('does not apply thesis front-matter rules to proposal reports', () => {
  const result = auditDocument(sample(), 'proposal', 'report', pack, DEFAULT_SETTINGS);
  expect(result.checks.filter(c => ['KEYWORDS', 'CLASSIFICATION', 'ABS-LENGTH'].includes(c.rule.id)).every(c => c.status === 'not_applicable')).toBe(true);
});
