import { describe, expect, it } from 'vitest';
import { renderPrintableSummary } from '../src/components/printSummary';
import type { Check, CheckItem, Report } from '../src/domain/types';

const report: Report = {
  id: 'print-test',
  engine: 'test',
  stage: 'predefense',
  kind: 'thesis',
  createdAt: '2026-11-26T00:00:00Z',
  ruleVersion: 'test',
  document: {
    name: '<img src=x onerror="x"> & 样稿.docx',
    format: 'docx',
    sha256: '',
    bytes: 0,
    paragraphs: [],
    sections: [],
    objects: [],
    limitations: [],
  },
  checks: [],
  elapsedMs: 0,
  steps: [],
};

function check(title: string, status: Check['status'], items: CheckItem[] = [], executed = true): Check {
  return {
    rule: { id: title, title, mode: 'body_size', stages: ['predefense'], strength: '', note: '', params: {},
      source: { pdf_page: 6, section: '', quote: '' } },
    status,
    summary: title,
    items,
    executed,
  };
}

describe('printable review summary', () => {
  it('counts executed rules and prioritizes actual findings before truncating each rule', () => {
    const items: CheckItem[] = [
      { status: 'pass', location: { paragraph: 1 }, observed: '合格证据' },
      ...Array.from({ length: 6 }, (_, index): CheckItem => ({
        status: 'manual', location: { paragraph: index + 2 }, observed: `待核对证据 ${index + 1}`,
      })),
      { status: 'warning', location: { paragraph: 8 }, observed: '建议证据' },
      { status: 'fail', location: { paragraph: 9 }, observed: '<失败证据>', expected: '12 磅', reason: '<样式来源>' },
    ];

    const html = renderPrintableSummary({ ...report, checks: [
      check('可人工核对', 'manual'),
      check('已关闭规则', 'manual', [], false),
      check('不适用规则', 'not_applicable'),
      check('已发现线索规则', 'pass'),
      check('字号核对', 'fail', items),
    ] });

    expect(html).toContain('1</strong>明确不符项');
    expect(html).toContain('0</strong>建议调整项');
    expect(html).toContain('1</strong>需人工确认项');
    expect(html).toContain('1</strong>已发现线索项');
    expect(html).not.toContain('已关闭规则');
    expect(html).not.toContain('不适用规则');
    expect(html).not.toContain('合格证据');
    expect(html).toContain('明确不符：&lt;失败证据&gt; → 12 磅。 &lt;样式来源&gt;');
    expect(html).toContain('建议调整：建议证据');
    expect(html).toContain('需人工确认：待核对证据 4');
    expect(html).not.toContain('待核对证据 5');
    expect(html).toContain('其余 2 处');
    expect(html).toContain('&lt;img src=x onerror=&quot;x&quot;&gt; &amp; 样稿.docx');
    expect(html).not.toContain('<img src=x');
    expect(html.indexOf('失败证据')).toBeLessThan(html.indexOf('建议证据'));
    expect(html.indexOf('建议证据')).toBeLessThan(html.indexOf('待核对证据'));
  });

  it('distinguishes an unchecked report from a report with no findings', () => {
    expect(renderPrintableSummary(report)).toContain('当前没有已执行的适用检查项');
    expect(renderPrintableSummary({ ...report, checks: [check('已通过的检查', 'pass')] }))
      .toContain('已执行的检查暂无偏差或待核对项');
  });
});
