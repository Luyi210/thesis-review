import { ZH } from '../readers/shared';
import { locationOf, type AuditDocument, type CheckItem, type FormatSpan, type Paragraph, type Rule } from './types';

const quoteLimit = 96;
const unreadable = '未能可靠读取';

function appendQuote(span: FormatSpan, text: string) {
  if (span.truncated) return;
  const capacity = quoteLimit - span.text.length;
  if (text.length <= capacity) {
    span.text += text;
  } else {
    // Never leave half of a supplementary Unicode character in a displayed quote.
    span.text += text.slice(0, capacity).replace(/[\uD800-\uDBFF]$/, '');
    span.truncated = true;
  }
}

export function checkTextFormat(p: Paragraph, rule: Rule, format: AuditDocument['format']) {
  const findings: CheckItem[] = [];
  const location = locationOf(p);
  const isFont = rule.mode === 'body_font';
  const isSize = rule.mode === 'body_size';
  const target = isSize ? rule.params.expected_pt ?? 12 : rule.params.expected_twips ?? 0;
  const expected = isFont ? '宋体 / SimSun' : isSize ? target + ' 磅' : target + ' twips';
  let examined = 0;
  // PDF text items share a line-level box; retain the measured values without
  // claiming native Word ranges or separate character coordinates for them.
  const pdfValues = new Map<'fail' | 'manual', Set<string>>();

  for (const [index, run] of p.runs.entries()) {
    const firstHan = run.text.search(ZH);
    if (firstHan < 0) continue;
    examined++;
    const value = isFont ? run.font : isSize ? run.size : run.spacing;
    const matches = typeof value === 'number'
      ? Math.abs(value - target) <= .05
      : value && rule.params.aliases?.some(alias => alias.toLowerCase() === value.toLowerCase());
    if (matches) continue;
    const status = value === null ? 'manual' : 'fail';
    const observed = value === null ? unreadable : String(value);

    if (format === 'pdf') {
      const values = pdfValues.get(status);
      if (values) values.add(observed);
      else pdfValues.set(status, new Set([observed]));
      continue;
    }

    const previous = findings[findings.length - 1];
    const span = previous?.formatSpan;
    // Word may split a word into several XML runs. Join only directly
    // consecutive runs with the same observed value and certainty.
    if (span && span.lastRun === index && previous.status === status && previous.observed === observed) {
      span.lastRun = index + 1;
      appendQuote(span, run.text);
      continue;
    }
    const firstRun = index + 1;
    const formatSpan: FormatSpan = { firstRun, lastRun: firstRun, text: '', truncated: false };
    // For bilingual runs, keep the script being assessed visible in the quote.
    appendQuote(formatSpan, run.text.slice(firstHan >= quoteLimit ? firstHan : 0));
    findings.push({
      location, observed, status, formatSpan,
      ...(status === 'manual' ? { reason: '这处文字的属性未能可靠读取，请在原稿中核实。' } : { expected }),
    });
  }
  for (const [status, values] of pdfValues) {
    findings.push({ location, status, observed: [...values].join('、'),
      ...(status === 'manual' ? { reason: '未知属性不能认定为格式不符。' } : { expected }) });
  }
  return { examined, findings };
}
