import { readFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocx } from '../src/readers/docx';
import { auditDocument } from '../src/domain/rules';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import type { RulePack } from '../src/domain/types';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const p = (text: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const chapter = (number = '一') => p(`第${number}章 测试`, '<w:outlineLvl w:val="0"/>');
const caption = (text = '图 1-1 合成图片') => p(text, '<w:jc w:val="center"/>');
const image = (mode = 'inline') => `<w:r><w:drawing><wp:${mode}><a:graphic><a:blip r:embed="image1"/></a:graphic></wp:${mode}></w:drawing></w:r>`;
const imageP = (mode = 'inline') => `<w:p>${image(mode)}</w:p>`;
const table = (properties = '', inner = '') => `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tr><w:tc>${p('表内测试文字')}${inner}</w:tc></w:tr></w:tbl>`;
async function audit(body: string) {
  const bytes = zipSync({ 'word/document.xml': strToU8(`<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:m="${M}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`) });
  const doc = await readDocx(bytes.buffer as ArrayBuffer, 'synthetic.docx', pack);
  return auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
}
const check = (report: Awaited<ReturnType<typeof audit>>, mode: string) => report.checks.find(c => c.rule.mode === mode)!;

describe('native object and caption evidence', () => {
  it('accepts a single inline picture with caption below and table with caption above', async () => {
    const r = await audit(chapter() + imageP() + caption() + p('普通正文') + caption('表 1-1 合成表格') + table());
    expect(check(r, 'caption_position').status).toBe('pass'); expect(check(r, 'caption_number').status).toBe('pass');
    expect(r.structure?.objects.filter(o => o.caption)).toHaveLength(2);
    expect(r.document.blocks?.map(b => b.kind)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'table']);
  });
  it('detects a picture caption above it and the mismatched chapter', async () => {
    const r = await audit(chapter() + caption('图 2-1 错误章号') + imageP());
    expect(check(r, 'caption_position').status).toBe('fail'); expect(check(r, 'caption_number').status).toBe('fail');
    expect(check(r, 'caption_number').items[0].reason).toContain('所在章1');
    expect(check(r, 'caption_position').items[0].location.paragraph).toBe(2);
  });
  it('detects a table caption after the table independently of its cell count', async () => {
    const r = await audit(chapter() + table() + caption('表 1-1 合成表格'));
    expect(check(r, 'caption_position').status).toBe('fail'); expect(check(r, 'caption_number').status).toBe('pass');
  });
  it('marks both occurrences of a duplicated same-chapter table number', async () => {
    const r = await audit(chapter() + caption('表 1-1 第一张表') + table() + p('分隔正文') + caption('表 1-1 第二张表') + table());
    expect(check(r, 'caption_number').items.filter(i => i.status === 'fail')).toHaveLength(2);
    expect(check(r, 'caption_number').items.every(i => i.reason?.includes('重复'))).toBe(true);
  });
  it('detects reversed sequence but does not invent a requirement for consecutive numbers', async () => {
    const backward = await audit(chapter() + imageP() + caption('图 1-2 第一幅') + p('正文') + imageP() + caption('图 1-1 第二幅'));
    expect(check(backward, 'caption_number').items.filter(i => i.status === 'fail')).toHaveLength(1);
    const gap = await audit(chapter() + imageP() + caption('图 1-1 第一幅') + p('正文') + imageP() + caption('图 1-3 第二幅'));
    expect(check(gap, 'caption_number').status).toBe('pass');
  });
  it('does not borrow the previous picture caption for the next picture', async () => {
    const r = await audit(chapter() + imageP() + caption() + imageP());
    expect(r.structure?.objects.filter(o => o.caption)).toHaveLength(1);
    expect(check(r, 'caption_position').status).toBe('manual');
    expect(check(r, 'caption_position').items.filter(i => i.status === 'fail')).toHaveLength(0);
  });
  it('does not borrow the next table caption for the previous table', async () => {
    const r = await audit(chapter() + table() + caption('表 1-1 相邻表题') + table());
    expect(r.structure?.objects.filter(o => o.caption)).toHaveLength(1); expect(check(r, 'caption_position').status).toBe('manual');
  });
  it('leaves a picture with independent candidate captions on both sides unresolved', async () => {
    const r = await audit(chapter() + caption('图 1-1 前题注') + imageP() + caption('图 1-2 后题注'));
    expect(r.structure?.objects[0].relation).toBe('unresolved'); expect(r.structure?.orphanCaptions).toHaveLength(2);
  });
  it('does not mistake an ordinary body reference for a caption', async () => {
    const r = await audit(chapter() + imageP() + p('图 1-1 说明本文所述情况。'));
    expect(check(r, 'caption_position').status).toBe('manual'); expect(r.structure?.objects[0].caption).toBeUndefined();
  });
  it.each(['unknown', 'reset'])('does not guess the chapter context: %s', async mode => {
    const prefix = mode === 'unknown' ? '' : chapter() + p('未编号的新章', '<w:outlineLvl w:val="0"/>');
    const r = await audit(prefix + imageP() + caption());
    expect(check(r, 'caption_position').status).toBe('pass'); expect(check(r, 'caption_number').status).toBe('manual');
  });
  it.each(['三', '十二', '二十三', '一百零二', '3'])('reads an explicit numbered chapter: %s', async token => {
    const numbers: Record<string, number> = { 三: 3, 十二: 12, 二十三: 23, 一百零二: 102, '3': 3 };
    const r = await audit(chapter(token) + imageP() + caption(`图 ${numbers[token]}-1 章节题注`));
    expect(check(r, 'caption_number').status).toBe('pass');
  });
  it('does not guess malformed Chinese chapter numerals', async () => {
    const r = await audit(chapter('一二') + imageP() + caption('图 2-1 测试'));
    expect(check(r, 'caption_number').status).toBe('manual');
  });
  it('does not let a wrong-chapter number create a false reversal in the correct chapter', async () => {
    const r = await audit(chapter() + imageP() + caption('图 2-99 错误章号') + p('正文') + imageP() + caption('图 1-2 正常编号'));
    const items = check(r, 'caption_number').items;
    expect(items.filter(i => i.status === 'fail')).toHaveLength(1);
    expect(items.find(i => i.observed.includes('正常编号'))?.status).toBe('pass');
  });
  it('keeps multi-level subfigure number syntax manual', async () => {
    const r = await audit(chapter() + imageP() + caption('图 1-1.2 子图编号'));
    expect(check(r, 'caption_number').status).toBe('manual');
  });
  it.each(['float', 'multi', 'mixed-text', 'nested-table', 'floating-table', 'unsupported', 'revision', 'hidden'])('keeps unsupported layouts manual: %s', async mode => {
    let body = chapter();
    if (mode === 'float') body += imageP('anchor') + caption();
    if (mode === 'multi') body += `<w:p>${image()}${image()}</w:p>` + caption();
    if (mode === 'mixed-text') body += `<w:p>${image()}<w:r><w:t>混排文本</w:t></w:r></w:p>` + caption();
    if (mode === 'nested-table') body += caption('表 1-1 嵌套表') + table('', table());
    if (mode === 'floating-table') body += caption('表 1-1 浮动表') + table('<w:tblpPr/>');
    if (mode === 'unsupported') body += imageP() + '<w:altChunk/>' + caption();
    if (mode === 'revision') body += '<w:ins>' + imageP() + caption() + '</w:ins>';
    if (mode === 'hidden') body += `<w:p><w:r><w:rPr><w:vanish/></w:rPr>${image().replace(/^<w:r>|<\/w:r>$/g, '')}</w:r></w:p>` + caption();
    const r = await audit(body);
    expect(check(r, 'caption_position').status).toBe('manual'); expect(check(r, 'caption_number').status).toBe('manual');
  });
  it('records an OMML formula anchor without claiming its math was checked', async () => {
    const r = await audit(chapter() + '<w:p><m:oMath><m:r><m:t>x+1=2</m:t></m:r></m:oMath></w:p>');
    expect(r.document.objects[0].kind).toBe('formula'); expect(r.document.objects[0].location.objectId).toBeTruthy();
    expect(r.document.paragraphs[1].text).toBe(''); expect(r.document.paragraphs[1].previewText).toBe('x+1=2');
    expect(r.structure?.objects[0].reason).toContain('未审核'); expect(check(r, 'caption_number').status).toBe('manual');
  });
  it('does not count a picture inside a deleted revision as a live object', async () => {
    const r = await audit(chapter() + `<w:p><w:del>${image()}</w:del></w:p>`);
    expect(r.document.objects).toHaveLength(0);
  });
  it('walks a content control while respecting the same associations', async () => {
    const r = await audit(chapter() + '<w:sdt><w:sdtPr/><w:sdtContent>' + imageP() + caption() + '</w:sdtContent></w:sdt>');
    expect(check(r, 'caption_position').status).toBe('pass');
  });
  it('keeps a disabled caption rule unexecuted despite available associations', async () => {
    const r = await audit(chapter() + imageP() + caption());
    const disabled = auditDocument(r.document, 'predefense', 'thesis', pack, { ...DEFAULT_SETTINGS, disabledRules: ['CAPTION-POSITION'] });
    expect(check(disabled, 'caption_position').executed).toBe(false); expect(check(disabled, 'caption_position').status).toBe('manual');
  });
  it('does not apply Word associations to PDF even if stale block data is present', async () => {
    const r = await audit(chapter() + imageP() + caption());
    const pdf = auditDocument({ ...r.document, format: 'pdf' }, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
    expect(check(pdf, 'caption_position').status).toBe('manual'); expect(check(pdf, 'caption_position').executed).toBe(false);
    expect(pdf.structure?.objects).toHaveLength(0);
  });
  it.each(['structure-correct.docx', 'structure-mixed.docx'])('checks a real DOCX fixture: %s', async name => {
    const b = await readFile(`tests/fixtures/${name}`); const doc = await readDocx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), name, pack);
    const r = auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
    if (name === 'structure-correct.docx') { expect(check(r, 'caption_position').status).toBe('pass'); expect(check(r, 'caption_number').status).toBe('pass'); }
    else {
      expect(check(r, 'caption_position').items.filter(i => i.status === 'fail')).toHaveLength(2);
      expect(check(r, 'caption_number').items.filter(i => i.status === 'fail')).toHaveLength(3);
      expect(r.structure?.objects.filter(o => o.caption)).toHaveLength(3);
      expect(r.structure?.orphanCaptions).toHaveLength(1);
    }
    expect(r.structure?.objects.find(o => o.objectId.startsWith('formula'))?.numbering).toBe('manual');
  });
});
