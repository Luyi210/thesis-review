import { describe, it, expect } from 'vitest';
import { emptyLabels, feedbackExport, FEEDBACK_LIMIT, reportMissed, reviewFinding, saveFeedback, suggestionSnapshot, teacherRewriteDraft } from '../src/domain/feedback';
import type { Check, Report } from '../src/domain/types';

const check: Check = {
  rule: { id: 'FMT-SIZE', mode: 'body_size', title: '字号', stages: ['predefense'], strength: 'required', note: '',
    source: { pdf_page: 6, section: '正文', quote: '小四号字' }, params: { expected_pt: 12 } },
  status: 'fail', summary: '存在一处偏差', executed: true, items: [
    { status: 'fail', location: { paragraph: 1, excerpt: '首段摘录' }, observed: '14', expected: '12 磅',
      formatSpan: { firstRun: 2, lastRun: 2, text: '局部', truncated: false } },
    { status: 'manual', location: { paragraph: 2, excerpt: '另一处' }, observed: '未知', reason: '无法读取' },
  ],
};
const report: Report = {
  id: 'version-a', createdAt: '2026-11-25T00:00:00Z', stage: 'predefense', kind: 'thesis', engine: 'engine', ruleVersion: 'rules',
  elapsedMs: 10, steps: [], checks: [check], document: { name: '测试者-私人原稿.docx', bytes: 123, sha256: 'doc-sha',
    format: 'docx', objects: [], sections: [], limitations: [], paragraphs: [
      { index: 1, text: '测试原稿', runs: [], heading: false, level: null, toc: false, inTable: false, excluded: false, caption: false, lineRule: null, lineTwips: null },
    ] },
};
const finding = (n: number) => ({ check, itemIndex: n, item: check.items[n], status: check.items[n].status });
const vote = { ...emptyLabels, accuracy: 'correct' as const };
const first = () => reviewFinding(report, finding(0), vote, suggestionSnapshot(report, finding(0)));

describe('local teacher feedback', () => {
  it('binds a label to the actual occurrence status, source and measured span', () => {
    const record = first();
    expect(record).toMatchObject({ itemIndex: 0, rule: { id: 'FMT-SIZE', page: 6 }, report: { id: 'version-a', fileHash: 'doc-sha' },
      reviewedAdvice: { source: 'template' }, evidence: { observed: '14', formatSpan: { text: '局部' } } });
    const other = reviewFinding(report, finding(1), vote, null);
    expect(other.evidence.status).toBe('manual');
    expect(other.evidence.observed).toBe('未知');
    expect(other.key).not.toBe(record.key);
    expect(() => reviewFinding(report, { ...finding(1), item: check.items[0] }, vote, null)).toThrow();
  });
  it('stores model wording, teacher rewrite and false-positive labels independently', () => {
    const advice = suggestionSnapshot(report, finding(0), { text: '核对字号。', steps: ['查看设置'], modelId: 'test-model', skillVersion: '0.1' });
    const record = reviewFinding(report, finding(0), { accuracy: 'false_positive', advice: 'rewrite', comment: '', replacement: '先核对此处是否为正文。' }, advice);
    expect(record.reviewedAdvice).toMatchObject({ source: 'model', steps: ['查看设置'], modelId: 'test-model' });
    expect(record.labels).toMatchObject({ accuracy: 'false_positive', advice: 'rewrite', replacement: '先核对此处是否为正文。' });
    expect(() => reviewFinding(report, finding(0), { ...vote, advice: 'rewrite', replacement: ' ' }, advice)).toThrow();
    expect(() => reviewFinding(report, finding(0), emptyLabels, advice)).toThrow();
    expect(() => reviewFinding(report, finding(0), { ...vote, advice: 'usable' }, null)).toThrow();
  });
  it('records whole-rule uncertainty without borrowing evidence from another item', () => {
    const record = reviewFinding(report, { check, itemIndex: -1, status: check.status }, vote, null);
    expect(record.itemIndex).toBe(-1); expect(record.evidence.location).toBeUndefined();
    expect(record.evidence.reason).toBe(check.summary);
  });
  it('records misses without a detected rule, bounds source locations and keeps versions separate', () => {
    const entry = reportMissed(report, { position: '1', ruleId: '', description: '首段的图题位置有问题。' });
    expect(entry).toMatchObject({ type: 'missed', rule: null, location: { paragraph: 1, excerpt: '测试原稿' } });
    expect(() => reportMissed(report, { position: '9', ruleId: '', description: '错误位置' })).toThrow();
    const pdf: Report = { ...report, id: 'pdf-check', document: { ...report.document, format: 'pdf', pageCount: 2 } };
    expect(reportMissed(pdf, { position: '2', ruleId: 'FMT-SIZE', description: '页脚异常' }).location).toEqual({ page: 2 });
    expect(() => reportMissed(pdf, { position: '3', ruleId: '', description: '错误位置' })).toThrow();
    expect(() => reportMissed(pdf, { position: '1', ruleId: 'missing-rule', description: '异常' })).toThrow();
    expect(() => reportMissed(pdf, { position: '1', ruleId: '', description: ' ' })).toThrow();
  });
  it('updates the same note, preserves historical labels, exports only labeled evidence', () => {
    const record = first();
    const old = saveFeedback([], record);
    const next = saveFeedback(old, { ...record, labels: { ...vote, comment: '定位正确' } });
    expect(old[0].key).toBe(next[0].key);
    expect(old).toHaveLength(1); expect(next).toHaveLength(1);
    const later = reviewFinding({ ...report, id: 'version-b' }, finding(0), vote, null);
    const snapshot = feedbackExport(saveFeedback(next, later));
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.map(e => e.report.id)).toEqual(['version-a', 'version-b']);
    expect(JSON.stringify(snapshot)).not.toContain(report.document.name);
    expect(JSON.stringify(snapshot)).not.toContain('"paragraphs"');
    expect(JSON.stringify(snapshot)).not.toContain('"checks"');
  });
  it('never silently evicts feedback at the memory cap and allows editing saved rows', () => {
    const record = first();
    const full = Array.from({ length: FEEDBACK_LIMIT }, (_, i) => ({ ...record, key: String(i) }));
    expect(() => saveFeedback(full, record)).toThrow(/先导出/);
    expect(saveFeedback(full, { ...record, key: '1' })).toHaveLength(FEEDBACK_LIMIT);
  });
  it('pairs only a confirmed occurrence with an explicit teacher rewrite', () => {
    const labels = { ...vote, advice: 'rewrite' as const, replacement: '选中局部文字，将字号设为小四。' };
    const confirmed = reviewFinding(report, finding(0), labels, null);
    const skipped = [
      first(), reviewFinding(report, finding(0), { ...labels, accuracy: 'false_positive' }, null),
      reviewFinding(report, { check, itemIndex: -1, status: check.status }, labels, null),
      reportMissed(report, { position: '1', ruleId: '', description: '漏掉的图题。' }),
    ];
    expect(teacherRewriteDraft(skipped).examples).toEqual([]);
    const draft = teacherRewriteDraft([confirmed, ...skipped]);
    expect(draft.examples).toHaveLength(1);
    expect(draft.examples[0]).toMatchObject({ teacherAdvice: labels.replacement, documentVersion: 'doc-sha',
      evidence: { selectedText: '局部', observed: '14', expected: '12 磅', status: 'fail' }, rule: { page: 6 } });
    expect(JSON.stringify(draft)).not.toContain('首段摘录');
    expect(JSON.stringify(draft)).not.toContain(report.document.name);
  });
});
