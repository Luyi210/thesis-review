import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readDocx } from '../src/readers/docx';
import { auditDocument } from '../src/domain/rules';
import { DEFAULT_SETTINGS, validateSettings } from '../src/domain/config';
import { buildMessages, normalizeWebLLMOutput, validateEvidenceTone, validateExplanations } from '../src/model/contracts';
import type { RulePack, Skill } from '../src/domain/types';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const skill: Skill = JSON.parse(await readFile('public/skills/predefense.json', 'utf8'));
const bytes = await readFile('public/samples/known-errors.docx');
const doc = await readDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'known.docx', pack);
const report = auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function xmlDoc(content: string, styles = '') {
  const files: Record<string, Uint8Array> = { 'word/document.xml': strToU8(`<w:document xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${content}</w:body></w:document>`) };
  if (styles) files['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`);
  return zipSync(files).buffer as ArrayBuffer;
}
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('native evidence and conservative verdicts', () => {
  it('finds exactly the four injected body format faults at the original paragraph', () => {
    expect(report.checks.filter(c => c.status === 'fail' && c.rule.id.startsWith('FMT-')).map(c => c.rule.id).sort()).toEqual(['FMT-FONT', 'FMT-LINE', 'FMT-SIZE', 'FMT-SPACING']);
    for (const id of ['FMT-FONT', 'FMT-LINE', 'FMT-SIZE', 'FMT-SPACING']) {
      const check = report.checks.find(c => c.rule.id === id)!;
      expect(check.items).toHaveLength(1); expect(check.items[0].location.paragraph).toBe(22);
    }
    expect(report.checks.find(c => c.rule.id === 'FMT-A4')?.status).toBe('pass');
    expect(doc.paragraphs.filter(p => p.toc).length).toBeGreaterThan(0);
  });
  it('does not mark a disabled format rule as checked or passed', () => {
    const disabled = auditDocument(doc, 'predefense', 'thesis', pack, { ...DEFAULT_SETTINGS, disabledRules: ['FMT-FONT'] }).checks.find(c => c.rule.id === 'FMT-FONT')!;
    expect(disabled.status).toBe('manual'); expect(disabled.executed).toBe(false);
  });
  it('limits the rules to the chosen stage and downgrades unconfirmed report formatting', () => {
    const proposal = auditDocument(doc, 'proposal', 'report', pack, DEFAULT_SETTINGS);
    expect(proposal.checks.filter(c => c.rule.id.startsWith('PRE-')).every(c => c.status === 'not_applicable')).toBe(true);
    expect(proposal.checks.find(c => c.rule.id === 'FMT-FONT')?.status).toBe('warning');
    expect(() => auditDocument(doc, 'predefense', 'report', pack, DEFAULT_SETTINGS)).toThrow();
  });
  it('does not turn unknown font data into a formatting failure', async () => {
    const unknown = await readDocx(xmlDoc(p('第一章 绪论') + p('这是没有显式字体数据的中文正文。')), 'unknown.docx', pack);
    expect(auditDocument(unknown, 'predefense', 'thesis', pack, DEFAULT_SETTINGS).checks.find(c => c.rule.id === 'FMT-FONT')?.status).toBe('manual');
  });
  it('preserves tabs and breaks; excludes hidden and deleted words', async () => {
    const result = await readDocx(xmlDoc('<w:p><w:r><w:t>甲</w:t><w:tab/><w:t>乙</w:t><w:br/><w:t>丙</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>隐藏内容</w:t></w:r><w:del><w:r><w:delText>删除内容</w:delText></w:r></w:del></w:p>'), 'visibility.docx', pack);
    expect(result.paragraphs[0].text).toBe('甲\t乙\n丙');
    expect(result.limitations.some(l => l.code === 'hidden-text' && l.affectsPresence)).toBe(true);
  });
  it('keeps all paragraphs of a TOC field excluded even after nested PAGEREF ends', async () => {
    const result = await readDocx(xmlDoc('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' + '<w:p><w:r><w:t>第一章 绪论</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGEREF one</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>' + p('第二章 研究设计') + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' + p('第一章 绪论') + p('真正正文')), 'toc.docx', pack);
    expect(result.paragraphs.map(p => p.toc)).toEqual([true, true, true, true, false, false]);
  });
  it('records tables and OMML as objects without claiming their layout passed', async () => {
    const result = await readDocx(xmlDoc('<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + p('表格文字') + '</w:tc></w:tr></w:tbl><w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>'), 'objects.docx', pack);
    expect(result.objects.map(o => o.kind).sort()).toEqual(['formula', 'table']);
    expect(result.paragraphs[0].inTable).toBe(true);
    expect(result.paragraphs[1].text).toBe('');
  });
  it('does not declare a missing AI statement when image content is not covered', async () => {
    const result = await readDocx(xmlDoc(p('第一章 绪论') + p('普通正文') + '<w:p><w:r><w:drawing/></w:r></w:p>'), 'image.docx', pack);
    const check = auditDocument(result, 'predefense', 'thesis', pack, DEFAULT_SETTINGS).checks.find(c => c.rule.mode === 'ai_declaration');
    expect(check?.status).toBe('manual');
  });
  it('rejects DTD instead of expanding user supplied XML entities', async () => {
    const data = zipSync({ 'word/document.xml': strToU8(`<!DOCTYPE doc [<!ENTITY x "body">]><w:document xmlns:w="${W}"><w:body/></w:document>`) });
    await expect(readDocx(data.buffer as ArrayBuffer, 'unsafe.docx', pack)).rejects.toThrow('DTD');
  });
});

describe('model output is evidence explanation only', () => {
  const check = report.checks.find(c => c.rule.id === 'FMT-FONT')!;
  const good = { explanations: [{ issue_id: 'FMT-FONT', explanation: '此处检测到黑体。', steps: ['回到 Word 核对该段中文字体。'] }] };
  it('accepts one explanation for the existing issue', () => { expect(validateExplanations(JSON.stringify(good), new Set(['FMT-FONT']))).toEqual(good.explanations); });
  it('rejects the observed overconfident PDF advice and preserves uncertainty', () => {
    expect(() => validateEvidenceTone([{ ...good.explanations[0], explanation: '正文字号未达到要求，小四号字（12磅）未满足。' }], 'warning')).toThrow('过于确定');
    expect(() => validateEvidenceTone([{ ...good.explanations[0], explanation: '此处为字号候选偏差，正文范围及原稿设置仍待核实。' }], 'warning')).not.toThrow();
    expect(() => validateEvidenceTone([{ ...good.explanations[0], explanation: '字号不符合要求，可能需要修改。' }], 'manual')).toThrow();
  });
  it('accepts the empty WebLLM nonthinking wrapper and refuses a nonempty thinking block', () => {
    expect(validateExplanations(normalizeWebLLMOutput('<think>\n\n</think>\n' + JSON.stringify(good)), new Set(['FMT-FONT']))).toEqual(good.explanations);
    expect(() => validateExplanations(normalizeWebLLMOutput('<think>hidden thoughts</think>' + JSON.stringify(good)), new Set(['FMT-FONT']))).toThrow();
  });
  it.each(['wrong-id', 'verdict', 'new-rule', 'truncated', 'empty-steps', 'extra-root'])('rejects %s without changing rule evidence', mode => {
    const copy = structuredClone(good) as any;
    if (mode === 'wrong-id') copy.explanations[0].issue_id = 'invented';
    if (mode === 'verdict') copy.explanations[0].status = 'pass';
    if (mode === 'new-rule') copy.explanations.push(good.explanations[0]);
    if (mode === 'empty-steps') copy.explanations[0].steps = [];
    if (mode === 'extra-root') copy.passed = true;
    expect(() => validateExplanations(mode === 'truncated' ? '{"explanations":[' : JSON.stringify(copy), new Set(['FMT-FONT']))).toThrow();
    expect(check.status).toBe('fail');
  });
  it('refuses to mix stage skills and sends only one issue with its source', () => {
    expect(() => buildMessages(report, check, { ...skill, stage: 'proposal' })).toThrow();
    const input = buildMessages(report, check, skill);
    expect(input[0].content).toContain('不能新增规则'); expect(input[1].content).toContain(doc.sha256);
    expect(input[1].content).toContain('FMT-FONT'); expect(input[1].content).not.toContain('FMT-SIZE');
  });
  it('explains failing evidence instead of the first passing object in a mixed rule', () => {
    const input = buildMessages(report, { ...check, items: [{ location: { paragraph: 1 }, observed: '此图正确', status: 'pass' }, { location: { paragraph: 5 }, observed: '图题在图前', status: 'fail' }] }, skill, 1);
    expect(input[1].content).toContain('图题在图前'); expect(input[1].content).not.toContain('此图正确');
  });
  it('rejects unknown models, invalid budgets and nonfinite parameters', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    for (const patch of [{ modelId: 'random' }, { contextWindow: 999999 }, { temperature: NaN }, { maxTokens: 0 }, { autoLoadCached: 'true' }]) expect(() => validateSettings({ ...DEFAULT_SETTINGS, ...patch })).toThrow();
  });
});
