import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarginNotes } from '../src/components/MarginNotes';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { buildMarginPositions, inspectMarginSelection, marginAdvice, marginInitialSelection, marginValues, type MarginSelection } from '../src/domain/marginNotes';
import { auditDocument } from '../src/domain/rules';
import type { Check, CheckItem, Location, Report, RulePack, Status } from '../src/domain/types';
import { readDocx } from '../src/readers/docx';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const file = await readFile('public/samples/known-errors.docx');
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const doc = await readDocx(buffer, '已知偏差.docx', pack);
const report = auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
const groups = buildMarginPositions(report);
function check(id: string, status: Status, items: CheckItem[] = []): Check {
  return { rule: pack.rules.find(r => r.id === id)!, status, summary: '请复核范围。', items, executed: true };
}
const item = (location: Location, status: Status): CheckItem => ({ location, observed: '候选', status });
function markup(value: Report | null, selected: MarginSelection | null) {
  return renderToStaticMarkup(createElement(MarginNotes, { report: value, selected, onSelect: () => {} }));
}

describe('margin notes for a real DOCX format check', () => {
  it('links all four format findings at paragraph 22 from any of their original selection IDs', () => {
    const selected = inspectMarginSelection(report, groups, { id: 'FMT-SIZE', item: 0 })!;
    expect(selected.location?.paragraph).toBe(22);
    expect(selected.findings.map(f => f.check.rule.id).sort()).toEqual(['FMT-FONT', 'FMT-LINE', 'FMT-SIZE', 'FMT-SPACING']);
    for (const id of ['FMT-SIZE', 'FMT-LINE', 'FMT-SPACING', 'FMT-FONT']) {
      expect(inspectMarginSelection(report, groups, { id, item: 0 })).toBe(selected);
    }
  });
  it('renders the selected location, actual guide link and specific instructions while leaving other locations out', () => {
    const output = markup(report, { id: 'FMT-SIZE', item: 0 });
    expect(output).toContain('源段落 22');
    expect(output).toContain('小四（12 磅）');
    expect(output).toContain('在字体的高级设置中将字符间距改为标准');
    expect(output).toContain('/rules/guide.pdf#page=6');
    expect(output).not.toContain('关键词数量不符');
    expect(output).not.toContain('twips');
  });
  it('can select the separate keyword annotation and read its own guide page', () => {
    const output = markup(report, { id: 'KEYWORDS', item: 0 });
    expect(output).toContain('关键词数量不符');
    expect(output).toContain('/rules/guide.pdf#page=3');
    expect(output).not.toContain('字符间距不符');
  });
  it('gives source order priority to the next concrete deviation and leaves the empty screen quiet', () => {
    const first = marginInitialSelection(report)!;
    expect(inspectMarginSelection(report, groups, first)?.findings[0].status).toBe('fail');
    expect(markup(null, null)).toContain('上传后');
    expect(markup(report, null)).not.toContain('当前批注');
    expect(markup({ ...report, checks: [] }, null)).toContain('没有可列出的批注');
  });
});

describe('location evidence and status boundaries', () => {
  it('groups the same PDF box but separates other boxes at the same paragraph or on another page', () => {
    const box = [10, 20, 60, 40];
    const a = { page: 1, paragraph: 12, bbox: box };
    const changed = { ...report, checks: [check('FMT-SIZE', 'warning', [
      item(a, 'warning'), item(a, 'manual'), item({ ...a, bbox: [70, 20, 150, 40] }, 'warning'),
      item({ ...a, page: 2 }, 'warning'),
    ])] };
    const positions = buildMarginPositions(changed);
    expect(positions.map(p => p.findings.map(f => f.itemIndex))).toEqual([[0, 1], [2], [3]]);
    expect(inspectMarginSelection(changed, positions, { id: 'FMT-SIZE', item: 1 })).toBe(positions[0]);
  });
  it('keeps different unlocated occurrences independent even if their excerpts match', () => {
    const positions = buildMarginPositions({ ...report, checks: [check('FMT-FONT', 'manual', [
      item({ excerpt: '重复段落' }, 'manual'), item({ excerpt: '重复段落' }, 'manual'),
    ])] });
    expect(positions).toHaveLength(2);
  });
  it('keeps a table distinct from its first cell text and still groups findings about the table', () => {
    const changed = { ...report, document: { ...doc, objects: [{ kind: 'table' as const, id: 't1', detail: '', location: { paragraph: 5 } }] },
      checks: [check('CAPTION-POSITION', 'manual', [item({ paragraph: 5, objectId: 't1' }, 'manual')]),
        check('CAPTION-NUMBER', 'manual', [item({ paragraph: 5, objectId: 't1' }, 'manual')]),
        check('FMT-FONT', 'fail', [item({ paragraph: 5, excerpt: '表格内文字' }, 'fail')])] };
    expect(buildMarginPositions(changed).map(p => [p.key, p.findings.length])).toEqual([['table:t1', 2], ['paragraph:0:5', 1]]);
  });
  it('gives a manual aggregate its own selection without marking the positively identified paragraph', () => {
    const changed = { ...report, checks: [check('CLASSIFICATION', 'manual', [item({ paragraph: 1 }, 'pass')])] };
    const positions = buildMarginPositions(changed);
    expect(positions).toHaveLength(1);
    expect(positions[0].location).toBeUndefined();
    expect(positions[0].findings[0]).toMatchObject({ itemIndex: -1, status: 'manual' });
    const positive = inspectMarginSelection(changed, positions, { id: 'CLASSIFICATION', item: 0 });
    expect(positive?.findings[0].status).toBe('pass');
    expect(marginInitialSelection(changed)).toBeNull();
  });
  it('retains a whole-document failure without inventing a source paragraph', () => {
    const changed = { ...report, checks: [check('REQ-AI', 'fail')] };
    expect(marginInitialSelection(changed)).toEqual({ id: 'REQ-AI', item: -1 });
    expect(markup(changed, { id: 'REQ-AI', item: 0 })).toContain('整份材料');
  });
  it('supports explicitly opened inapplicable records without listing them as annotations', () => {
    const changed = { ...report, checks: [check('FMT-SIZE', 'not_applicable')] };
    expect(buildMarginPositions(changed)).toEqual([]);
    expect(markup(changed, { id: 'FMT-SIZE', item: 0 })).toContain('不适用');
    expect(markup(changed, { id: 'FMT-SIZE', item: 0 })).not.toContain('将字号设为');
  });
  it('keeps unexecuted checks out of the navigator while preserving their full record and the empty-state route', () => {
    const disabled = { ...check('FMT-SIZE', 'manual'), executed: false, summary: '本项已关闭，未执行。' };
    const changed = { ...report, checks: [disabled] };
    expect(buildMarginPositions(changed)).toEqual([]);
    expect(marginInitialSelection(changed)).toBeNull();
    expect(markup(changed, null)).toContain('更多工具 → 完整检查记录');
    expect(markup(changed, null)).not.toContain('批注导航');
    const detail = markup(changed, { id: 'FMT-SIZE', item: 0 });
    expect(detail).toContain('本项已关闭，未执行。');
    expect(detail).not.toContain('将字号设为');
    const manual = check('CAPTION-POSITION', 'manual', [item({ paragraph: 5 }, 'manual')]);
    const review = buildMarginPositions({ ...report, checks: [disabled, manual, check('REQ-AI', 'manual')] });
    expect(review.map(p => p.findings[0].check.rule.id)).toEqual(['CAPTION-POSITION', 'REQ-AI']);
  });
  it('converts values from twips into Word spacing settings and distinguishes a negative value', () => {
    const f = { check: check('FMT-SPACING', 'fail'), itemIndex: 0, item: { location: {}, status: 'fail' as const, observed: '-20、40', expected: '0 twips' }, status: 'fail' as const };
    expect(marginValues(f)).toEqual({ observed: '紧缩 1 磅、加宽 2 磅', expected: '标准' });
  });
  it('keeps the PDF and stage-report scope caveats in instructions', () => {
    const f = { check: check('FMT-SIZE', 'warning'), item: item({ paragraph: 1 }, 'warning'), itemIndex: 0, status: 'warning' as const };
    expect(marginAdvice(f, { ...report, document: { ...doc, format: 'pdf' } })).toContain('先核实这行是否属于正文');
    expect(marginAdvice(f, { ...report, kind: 'report', stage: 'proposal' })).toContain('先确认本阶段');
  });
});
