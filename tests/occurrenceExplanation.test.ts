import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OccurrenceExplanation, type ExplanationControls } from '../src/components/OccurrenceExplanation';
import type { Check, Report, Skill } from '../src/domain/types';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { buildMessages, explanationKey, explanationSchema, explanationTarget } from '../src/model/contracts';
import { BrowserModel } from '../src/model/runtime';

const check: Check = {
  status: 'fail', executed: true, summary: '本规则在其他段落也发现不同字号。',
  rule: { id: 'FMT-SIZE', mode: 'body_size', title: '正文字号', strength: 'required', stages: ['predefense'],
    params: { expected_pt: 12 }, note: '', source: { pdf_page: 6, section: '正文', quote: '正文使用小四号字。' } },
  items: [
    { status: 'fail', location: { paragraph: 3, excerpt: '相邻文字及两个错误片段' }, observed: '10.5', expected: '12 磅',
      formatSpan: { firstRun: 2, lastRun: 2, text: '小字号片段', truncated: false } },
    { status: 'fail', location: { paragraph: 3, excerpt: '相邻文字及两个错误片段' }, observed: '14', expected: '12 磅',
      formatSpan: { firstRun: 4, lastRun: 4, text: '大字号片段', truncated: false } },
    { status: 'manual', location: { paragraph: 9, excerpt: '字号未能确定的段落' }, observed: '字号未知', reason: '字号来源待确认' },
  ],
};
const report: Report = {
  id: 'report-1', document: { name: '示例', format: 'docx', sha256: 'abc', bytes: 0, paragraphs: [], sections: [], objects: [], limitations: [] },
  stage: 'predefense', kind: 'thesis', ruleVersion: '1', engine: 'test', createdAt: '', checks: [check], elapsedMs: 0, steps: [],
};
const skill: Skill = { id: 's', stage: 'predefense', name: '', version: '0.2', tools: [], instructions: [], references: [], outputContract: '' };

function output(index: number, changes = {}) {
  const target = explanationTarget(report, check, index);
  return JSON.stringify({ explanations: [{ issue_id: check.rule.id, evidence_id: target.key, evidence_status: target.status,
    explanation: '此处应对照原稿核实。', steps: ['在 Word 的字体设置中核对。'], ...changes }] });
}
function setup(raw: string, tokenize: () => Promise<number[]> = async () => []) {
  const runtime = new BrowserModel();
  Object.assign(runtime, { loadedContext: DEFAULT_SETTINGS.contextWindow, engine: { tokenize,
    chat: { completions: { create: vi.fn(async () => ({ choices: [{ finish_reason: 'stop', message: { content: raw } }] })) } },
  } });
  runtime.state = { modelId: DEFAULT_SETTINGS.modelId, phase: 'ready', progress: 1, text: '' };
  return runtime;
}
describe('evidence for an individual annotation', () => {
  it('sends only the selected run, even when two opposite deviations share one paragraph', () => {
    const prompt = buildMessages(report, check, skill, 1)[1].content;
    expect(prompt).toContain('大字号片段');
    expect(prompt).toContain('"observed":"14"');
    for (const other of ['小字号片段', '10.5', '相邻文字', '其他段落', '字号未知']) expect(prompt).not.toContain(other);
    const target = explanationTarget(report, check, 1);
    const fields = explanationSchema(target).properties.explanations.items.properties;
    expect(fields.evidence_id.enum).toEqual([target.key]);
    expect(fields.evidence_status.enum).toEqual(['fail']);
    expect(explanationKey(report.id, check.rule.id, 0)).not.toBe(target.key);
    expect(explanationKey('report-2', check.rule.id, 1)).not.toBe(target.key);
  });
  it('keeps a whole-rule summary separate and rejects out-of-range indices', () => {
    const prompt = buildMessages(report, check, skill, -1)[1].content;
    expect(prompt).toContain(check.summary);
    expect(prompt).not.toContain('selected_text');
    expect(prompt).not.toContain('"observed"');
    for (const invalid of [3, -2, 0.5, NaN]) expect(() => buildMessages(report, check, skill, invalid)).toThrow('失效');
  });
  it('returns provenance for the selected evidence after a valid response', async () => {
    const result = await setup(output(1)).explain(report, check, skill, DEFAULT_SETTINGS, 1);
    expect(result).toMatchObject({ reportId: report.id, targetKey: explanationKey(report.id, check.rule.id, 1),
      itemIndex: 1, ruleId: 'FMT-SIZE', sourcePage: 6, status: 'fail', documentSha256: 'abc', location: check.items[1].location });
  });
  it('leaves footnote bracket corrections to the rule even with a loaded model', async () => {
    const local: Check = { ...check, rule: { ...check.rule, mode: 'footnote_brackets' } };
    const tokenize = vi.fn(async () => [1]);
    await expect(setup('27 应改为 26', tokenize).explain({ ...report, checks: [local] }, local, skill, DEFAULT_SETTINGS, 0))
      .rejects.toThrow('脚注编号');
    expect(tokenize).not.toHaveBeenCalled();
  });
  it('rejects stale rule objects, stale occurrence output and a mismatched evidence status', async () => {
    await expect(setup(output(1)).explain(report, { ...check }, skill, DEFAULT_SETTINGS, 1)).rejects.toThrow('当前稿件');
    await expect(setup(output(0)).explain(report, check, skill, DEFAULT_SETTINGS, 1)).rejects.toThrow('位置或证据状态');
    await expect(setup(output(2, { evidence_status: 'fail' })).explain(report, check, skill, DEFAULT_SETTINGS, 2)).rejects.toThrow('位置或证据状态');
  });
  it('uses item-level uncertainty even when the check as a whole failed', async () => {
    const prompt = buildMessages(report, check, skill, 2)[1].content;
    expect(prompt).toContain('"evidence_status":"manual"');
    expect(prompt).toContain('字号来源待确认');
    const bad = output(2, { explanation: '此处尚待核实。', steps: ['这个段落不合格。'] });
    await expect(setup(bad).explain(report, check, skill, DEFAULT_SETTINGS, 2)).rejects.toThrow('过于确定');
  });
  it('rejects a different occurrence’s measured point size or a made-up guide page', async () => {
    await expect(setup(output(1, { explanation: '这里检测到 10.5 磅。' })).explain(report, check, skill, DEFAULT_SETTINGS, 1)).rejects.toThrow('磅值');
    await expect(setup(output(1, { steps: ['见《撰写指南》第 9 页。'] })).explain(report, check, skill, DEFAULT_SETTINGS, 1)).rejects.toThrow('指南页码');
  });
  it('locks during tokenization and lets cancellation immediately release the pending explanation', async () => {
    const runtime = setup('', () => new Promise(() => {}));
    const pending = runtime.explain(report, check, skill, DEFAULT_SETTINGS, 0);
    expect(runtime.state.phase).toBe('generating');
    await expect(runtime.explain(report, check, skill, DEFAULT_SETTINGS, 1)).rejects.toThrow();
    runtime.cancel();
    await expect(pending).rejects.toThrow('取消');
    expect(runtime.state.phase).toBe('idle');
  });
});

describe('browser model preparation from an annotation', () => {
  function render(controls: Partial<ExplanationControls>) {
    return renderToStaticMarkup(createElement(OccurrenceExplanation, {
      check, itemIndex: 0, target: explanationTarget(report, check, 0).key,
      controls: {
        phase: 'idle', pendingKey: null, errors: {}, results: {},
        onExplain: vi.fn(), onConfigure: vi.fn(), onCancel: vi.fn(), ...controls,
      },
    }));
  }

  it('shows a direct download with its size when available and settings otherwise', () => {
    const supported = render({ onLoadModel: vi.fn(), modelDownload: '约 984 MB' });
    expect(supported).toContain('下载或加载本机模型');
    expect(supported).toContain('首次下载约 984 MB');
    expect(render({})).toContain('查看本机模型配置');
  });

  it('shows cancellable progress during preparation and the explain action when ready', () => {
    const loading = render({ phase: 'loading', modelProgress: 0.25 });
    expect(loading).toContain('aria-label="本机模型准备进度"');
    expect(loading).toContain('value="0.25"');
    expect(loading).toContain('取消准备本机模型');
    expect(render({ phase: 'ready' })).toContain('用本地模型解释这一处');
  });
});
