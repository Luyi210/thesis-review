import { describe, expect, it } from 'vitest';
import { captureVersion, compareVersions, retainVersions, occurrenceLabel, versionProvenance, SESSION_BYTE_LIMIT, type VersionSnapshot } from '../src/domain/versions';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { paragraph } from '../src/readers/shared';
import type { Check, Report, Rule, Status } from '../src/domain/types';

const rule: Rule = { id: 'FONT', title: '正文字体', mode: 'body_font', stages: ['predefense'], strength: 'required', note: '', source: { pdf_page: 6, section: 'format', quote: '宋体' }, params: {} };
function check(status: Status, executed = true): Check { return { rule, status, executed, summary: '测试', items: status === 'fail' || status === 'warning' ? [{ location: { paragraph: 2, excerpt: '测试正文' }, observed: '黑体', status }] : [] }; }
function snapshot(id: string, status: Status = 'fail'): VersionSnapshot {
  const report: Report = { id, engine: 'engine-v1', ruleVersion: 'rules-v1', stage: 'predefense', kind: 'thesis', createdAt: '2026-11-25T00:00:00Z', elapsedMs: 1, steps: [], checks: [check(status)], document: { name: `${id}.docx`, format: 'docx', sha256: id.padEnd(64, '0'), bytes: 3, paragraphs: [paragraph(1, '测试正文')], sections: [], objects: [], limitations: [] } };
  return { result: { report, pack: { id: 'college', title: 'college', version: 'rules-v1', review_status: 'draft', rules: [rule], scope_notes: [], source: { sha256: 'guide', document_date: '2026-05-26' } }, buffer: new ArrayBuffer(3), skill: { id: 'skill', name: 'skill', stage: 'predefense', version: 'v1', instructions: ['规则核对'], tools: [], outputContract: '', references: [] } }, settings: { ...DEFAULT_SETTINGS, disabledRules: [] }, rulesHash: 'rules-hash', guideHash: 'guide' };
}
describe('version evidence changes', () => {
  it.each([['fail', 'fail'], ['warning', 'fail'], ['fail', 'warning'], ['warning', 'warning']] as [Status, Status][])('preserves %s to %s as still detected', (a, b) => {
    const result = compareVersions(snapshot('old', a), snapshot('new', b)); expect(result.rows[0].kind).toBe('persisting'); expect(result.rows[0].reason).toContain('不表示');
  });
  it('calls fail to pass not observed rather than repaired', () => {
    const result = compareVersions(snapshot('old', 'fail'), snapshot('new', 'pass')); expect(result.rows[0].kind).toBe('not_observed'); expect(result.rows[0].reason).toContain('不能直接认定已修复'); expect(result.basis).toContain('删除内容');
  });
  it('calls pass to fail newly detected with an explicit coverage caveat', () => {
    const result = compareVersions(snapshot('old', 'pass'), snapshot('new', 'fail')); expect(result.rows[0].kind).toBe('newly_observed'); expect(result.rows[0].reason).toContain('可读取范围');
  });
  it.each([['fail', 'manual'], ['manual', 'fail'], ['pass', 'manual'], ['manual', 'pass']] as [Status, Status][])('does not equate %s to %s with a fix or regression', (a, b) => { expect(compareVersions(snapshot('old', a), snapshot('new', b)).rows[0].kind).toBe('uncertain'); });
  it('does not treat an unexecuted item as a passed replacement', () => {
    const next = snapshot('new', 'pass'); next.result.report.checks[0].executed = false;
    expect(compareVersions(snapshot('old'), next).rows[0].kind).toBe('uncertain');
  });
  it('leaves a disappeared check unresolved', () => {
    const next = snapshot('new'); next.result.report.checks = [];
    expect(compareVersions(snapshot('old'), next).rows[0].kind).toBe('uncertain');
  });
  it('does not claim a moved paragraph is the same occurrence', () => {
    const next = snapshot('new'); next.result.report.checks[0].items[0].location.paragraph = 20;
    const result = compareVersions(snapshot('old'), next); expect(result.rows[0].kind).toBe('persisting'); expect(result.basis).toContain('不自动匹配同一处错误');
  });
  it.each(['stage', 'kind', 'engine', 'ruleVersion', 'rulesHash', 'guideHash', 'format', 'disabled'])('blocks comparison when %s differs', key => {
    const before = snapshot('old'); const after = snapshot('new');
    if (key === 'stage') after.result.report.stage = 'midterm';
    if (key === 'kind') after.result.report.kind = 'report';
    if (key === 'engine') after.result.report.engine = 'engine-v2';
    if (key === 'ruleVersion') after.result.report.ruleVersion = 'rules-v2';
    if (key === 'rulesHash') after.rulesHash = 'different-rules';
    if (key === 'guideHash') after.guideHash = 'different-guide';
    if (key === 'format') after.result.report.document.format = 'pdf';
    if (key === 'disabled') after.settings.disabledRules = ['FONT'];
    const result = compareVersions(before, after); expect(result.comparable).toBe(false); expect(result.reasons).toHaveLength(1); expect(result.rows).toHaveLength(0);
  });
  it('recognises the same file and ignores model settings in rule comparability', () => {
    const a = snapshot('same'); const b = snapshot('same'); b.settings.modelId = 'different-model'; b.settings.maxTokens = 500;
    const result = compareVersions(a, b); expect(result.sameFile).toBe(true); expect(result.comparable).toBe(true);
  });
  it('normalises execution switch ordering', () => {
    const a = snapshot('old'); const b = snapshot('new'); a.settings.disabledRules = ['one', 'two']; b.settings.disabledRules = ['two', 'one']; expect(compareVersions(a, b).comparable).toBe(true);
  });
  it('does not manufacture changed rows for unchanged nonalert checks', () => { expect(compareVersions(snapshot('old', 'pass'), snapshot('new', 'pass')).rows).toHaveLength(0); expect(compareVersions(snapshot('old', 'manual'), snapshot('new', 'manual')).rows).toHaveLength(0); });
  it('reports mixed issue counts without hiding manual occurrences', () => {
    const c = check('fail'); c.items.push({ location: {}, observed: 'unknown', status: 'manual' }); expect(occurrenceLabel(c)).toBe('1处偏差 / 1处待确认');
    expect(occurrenceLabel({ ...c, items: [] })).toContain('项目级'); expect(occurrenceLabel({ ...c, executed: false })).toBe('未执行');
  });
});
describe('bounded session-only versions', () => {
  it('retains the newest five records and the explicitly selected baseline', () => {
    let history = [snapshot('base')];
    for (let i = 0; i < 7; i++) history = retainVersions(history, snapshot(`new${i}`), 'base').history;
    expect(history).toHaveLength(5); expect(history[0].result.report.id).toBe('base'); expect(history.at(-1)?.result.report.id).toBe('new6');
  });
  it('replaces duplicate repeated checks when they are not the baseline', () => {
    const a = snapshot('first'); const b = snapshot('second'); b.result.report.document.sha256 = a.result.report.document.sha256;
    const history = retainVersions([a], b).history; expect(history).toHaveLength(1); expect(history[0].result.report.id).toBe('second');
  });
  it('keeps the chosen baseline immutable during a same-file recheck', () => {
    const a = snapshot('base'); const b = snapshot('new'); b.result.report.document.sha256 = a.result.report.document.sha256;
    const history = retainVersions([a], b, 'base').history; expect(history).toHaveLength(2); expect(history[0]).toBe(a);
  });
  it('evicts unprotected original buffers when their sum exceeds 160 MiB', () => {
    const baseline = snapshot('base'); const old = snapshot('old'); const next = snapshot('next');
    baseline.result.buffer = new ArrayBuffer(80 * 1024 * 1024); old.result.buffer = new ArrayBuffer(5 * 1024 * 1024); next.result.buffer = new ArrayBuffer(80 * 1024 * 1024);
    const result = retainVersions([baseline, old], next, 'base'); expect(result.dropped).toBe(1); expect(result.history.reduce((n,v) => n + v.result.buffer.byteLength,0)).toBe(SESSION_BYTE_LIMIT); expect(result.history).toEqual([baseline, next]);
  });
  it('captures the rules and execution switches used by the historical report', async () => {
    const a = snapshot('one'); const settings = { ...a.settings, disabledRules: ['FONT'] };
    const stored = await captureVersion(a.result, settings); settings.disabledRules.push('PAGE'); expect(stored.settings.disabledRules).toEqual(['FONT']); expect(stored.rulesHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('exports the exact comparison context instead of model settings', () => {
    const s = snapshot('base'); const p = versionProvenance(s);
    expect(p.stage).toBe('predefense'); expect(p.guideHash).toBe('guide'); expect(p.rulesHash).toBe('rules-hash'); expect(p.engine).toBe('engine-v1'); expect(p.sha256).toBe(s.result.report.document.sha256); expect(p).not.toHaveProperty('modelId');
  });
});
