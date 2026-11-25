import { readFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { marginAdvice } from '../src/domain/marginNotes';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { auditDocument } from '../src/domain/rules';
import type { RulePack } from '../src/domain/types';
import { readDocx } from '../src/readers/docx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const run = (text: string, properties = '') =>
  '<w:r><w:rPr>' + properties + '</w:rPr><w:t>' + text + '</w:t></w:r>';
const styles = '<w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="character" w:styleId="Fine">' +
  '<w:rPr><w:sz w:val="21"/></w:rPr></w:style></w:styles>';
const black = '<w:rFonts w:eastAsia="黑体"/>';
async function audit(content: string, stage: 'predefense' | 'proposal' = 'predefense', parts: Record<string, Uint8Array> = {}) {
  const document = '<w:document xmlns:w="' + W + '"><w:body><w:p>' + run('第一章 实验设计') +
    '</w:p><w:p>' + content + '</w:p></w:body></w:document>';
  const bytes = zipSync({ 'word/document.xml': strToU8(document), 'word/styles.xml': strToU8(styles), ...parts });
  const doc = await readDocx(bytes.buffer as ArrayBuffer, '混排合成稿.docx', pack);
  return auditDocument(doc, stage, stage === 'predefense' ? 'thesis' : 'report', pack, DEFAULT_SETTINGS);
}

describe('native Word character formatting evidence', () => {
  it('tracks small, large, and unreadable text separately, retaining the whole paragraph anchor', async () => {
    const report = await audit(
      run('正确中文。') + run('五', '<w:rStyle w:val="Fine"/>') + run('号', '<w:sz w:val="21"/>') +
      run('正常') + run('偏大', '<w:sz w:val="28"/>') + run('未定', '<w:sz w:val="?"/>') +
      run('另一处五号', '<w:sz w:val="21"/>')
    );
    const items = report.checks.find(c => c.rule.id === 'FMT-SIZE')!.items;
    expect(items.map(i => [i.status, i.observed, i.formatSpan])).toEqual([
      ['fail', '10.5', { firstRun: 2, lastRun: 3, text: '五号', truncated: false }],
      ['fail', '14', { firstRun: 5, lastRun: 5, text: '偏大', truncated: false }],
      ['fail', '10.5', { firstRun: 7, lastRun: 7, text: '另一处五号', truncated: false }],
      ['manual', '未能可靠读取', { firstRun: 6, lastRun: 6, text: '未定', truncated: false }],
    ]);
    expect(items.every(i => i.location.paragraph === 2 && i.location.excerpt === report.document.paragraphs[1].text)).toBe(true);
    expect(items[0].expected).toBe('12 磅');
    expect(items[3].expected).toBeUndefined();
    const check = report.checks.find(c => c.rule.id === 'FMT-SIZE')!;
    expect(marginAdvice({ check, item: items[0], itemIndex: 0, status: 'fail' }, report)).toContain('批注所引片段中的中文文字');
  });

  it('separates identical Chinese font findings across compliant or Latin-only runs', async () => {
    const report = await audit(run('正常') + run('重复', black) + run('Latin', black) +
      run('重复', black) + run('正常') + run('字体待定', '<w:rFonts w:eastAsiaTheme="majorEastAsia"/>'));
    const check = report.checks.find(c => c.rule.id === 'FMT-FONT')!;
    expect(check.items.map(i => [i.status, i.formatSpan?.firstRun, i.formatSpan?.text])).toEqual([
      ['fail', 2, '重复'], ['fail', 4, '重复'], ['manual', 6, '字体待定'],
    ]);
    expect(check.items[0].observed).toBe('黑体');
  });

  it('records tight and expanded character spacing, keeping local evidence when a stage downgrades severity', async () => {
    const report = await audit(run('加宽', '<w:spacing w:val="20"/>') + run('标准') +
      run('紧缩', '<w:spacing w:val="-10"/>') + run('待核', '<w:spacing w:val="unknown"/>'), 'proposal');
    const check = report.checks.find(c => c.rule.id === 'FMT-SPACING')!;
    expect(check.items.map(i => [i.status, i.observed, i.formatSpan?.text])).toEqual([
      ['warning', '20', '加宽'], ['warning', '-10', '紧缩'], ['manual', '未能可靠读取', '待核'],
    ]);
    expect(check.items[0].expected).toBe('0 twips');
  });

  it('bounds long quotations without splitting Unicode or replacing the source paragraph', async () => {
    const report = await audit(run('中'.repeat(95) + '🧪多个中文字符', black) + run('另一段文字', black));
    const [item] = report.checks.find(c => c.rule.id === 'FMT-FONT')!.items;
    expect(item.formatSpan).toEqual({ firstRun: 1, lastRun: 2, text: '中'.repeat(95), truncated: true });
    expect(item.location.excerpt).toContain('🧪多个中文字符');
  });
});


describe('Word style evidence for mixed native runs', () => {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const theme = strToU8('<a:theme xmlns:a="' + A + '"><a:themeElements><a:fontScheme><a:minorFont>' +
    '<a:ea typeface="黑体"/><a:font script="Hans" typeface="宋体"/><a:font script="Hant" typeface="繁体字型"/>' +
    '</a:minorFont></a:fontScheme></a:themeElements></a:theme>');
  const themedStyles = strToU8('<w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:eastAsia="旧字体"/><w:sz w:val="32"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:styleId="Normal" w:default="true"><w:rPr>' +
    '<w:rFonts w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>');
  it('resolves the document theme language over the run’s proofing language, then respects direct font overrides', async () => {
    const r = await audit(run('模板中的正文', '<w:lang w:eastAsia="zh-TW"/>') +
      run('直接改黑体', black) + run('再次直接指定主题', '<w:rFonts w:eastAsia="黑体" w:eastAsiaTheme="minorEastAsia"/>'),
    'predefense', { 'word/styles.xml': themedStyles, 'word/theme/theme1.xml': theme,
      'word/settings.xml': strToU8('<w:settings xmlns:w="' + W + '"><w:themeFontLang w:eastAsia="zh-Hans-CN"/></w:settings>') });
    const check = r.checks.find(c => c.rule.id === 'FMT-FONT')!;
    expect(check.items.map(i => [i.status, i.observed, i.formatSpan?.text])).toEqual([['fail', '黑体', '直接改黑体']]);
    expect(r.checks.find(c => c.rule.id === 'FMT-SIZE')!.status).toBe('pass');
  });
  it('uses the default East Asian theme slot without document theme language and keeps unresolved theme names manual', async () => {
    const r = await audit(run('默认东亚槽', '<w:lang w:eastAsia="zh-CN"/>') +
      run('其他主题槽', '<w:rFonts w:eastAsiaTheme="minorHAnsi"/>'),
    'predefense', { 'word/styles.xml': themedStyles, 'word/theme/theme1.xml': theme });
    const check = r.checks.find(c => c.rule.id === 'FMT-FONT')!;
    expect(check.items.map(i => [i.status, i.observed, i.formatSpan?.text])).toEqual([
      ['fail', '黑体', '默认东亚槽'], ['manual', '未能可靠读取', '其他主题槽']
    ]);
  });
  it('avoids ordinary font/size verdicts for forced complex-script or right-to-left runs', async () => {
    const r = await audit(run('复杂文字', black + '<w:sz w:val="18"/><w:cs/>') +
      run('另一处复杂文字', black + '<w:sz w:val="32"/><w:rtl/>') + run('显式关闭', '<w:cs w:val="false"/>'));
    for (const id of ['FMT-SIZE', 'FMT-FONT']) {
      const check = r.checks.find(c => c.rule.id === id)!;
      expect(check.status).toBe('manual');
      expect(check.items.map(i => [i.status, i.formatSpan?.text])).toEqual([['manual', '复杂文字另一处复杂文字']]);
    }
  });
});
