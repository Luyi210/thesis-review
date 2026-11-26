import { marginAdvice, type MarginFinding } from './marginNotes';
import type { FormatSpan, Location, Report, Rule, Status } from './types';

export const FEEDBACK_LIMIT = 500;
export const FEEDBACK_TEXT_LIMIT = 1200;
export type Accuracy = 'unrated' | 'correct' | 'false_positive' | 'incorrect' | 'uncertain';
export type AdviceRating = 'unrated' | 'usable' | 'rewrite';
export const accuracyNames: Record<Accuracy, string> = {
  unrated: '未评价', correct: '判得对', false_positive: '误报', incorrect: '判断有误', uncertain: '暂无法判断',
};
export const adviceNames: Record<AdviceRating, string> = {
  unrated: '未评价', usable: '可以照着改', rewrite: '需要改写或补充',
};
export interface ReviewLabels {
  accuracy: Accuracy; advice: AdviceRating; comment: string; replacement: string;
}
export const emptyLabels: ReviewLabels = { accuracy: 'unrated', advice: 'unrated', comment: '', replacement: '' };
export interface FeedbackModelAdvice { text: string; steps: string[]; modelId: string; skillVersion: string }
export type AdviceSnapshot = { source: 'template'; text: string } | ({ source: 'model' } & FeedbackModelAdvice);
type RuleReference = { id: string; title: string; page?: number; quote: string; kind?: 'document' };
type Source = Pick<Report, 'id' | 'engine' | 'stage' | 'kind' | 'createdAt' | 'ruleVersion'> & {
  fileHash: string; format: 'docx' | 'pdf';
};
interface BaseRecord { key: string; report: Source; updatedAt: string }
export interface ReviewedFinding extends BaseRecord {
  type: 'finding'; rule: RuleReference; itemIndex: number; evidence: {
    status: Status; executed: boolean; location?: Location; observed?: string; expected?: string; reason?: string;
    formatSpan?: FormatSpan;
  };
  reviewedAdvice: AdviceSnapshot | null; labels: ReviewLabels;
}
export interface MissedFinding extends BaseRecord {
  type: 'missed'; rule: RuleReference | null; location: Location; description: string;
}
export type FeedbackEntry = ReviewedFinding | MissedFinding;

function reportSource(report: Report): Source {
  return { id: report.id, createdAt: report.createdAt, engine: report.engine, stage: report.stage, kind: report.kind,
    ruleVersion: report.ruleVersion, fileHash: report.document.sha256, format: report.document.format };
}
function ruleReference(rule: Rule): RuleReference {
  return { id: rule.id, title: rule.title, page: rule.source.pdf_page, quote: rule.source.quote,
    ...(rule.source.kind === 'document' ? { kind: 'document' as const } : {}) };
}
export function findingFeedbackKey(reportId: string, ruleId: string, itemIndex: number) {
  return JSON.stringify([reportId, ruleId, itemIndex]);
}
export function suggestionSnapshot(report: Report, finding: MarginFinding, model?: FeedbackModelAdvice): AdviceSnapshot | null {
  if (model) return { source: 'model', modelId: model.modelId, skillVersion: model.skillVersion,
    text: model.text, steps: [...model.steps] };
  const text = marginAdvice(finding, report);
  return text ? { source: 'template', text } : null;
}
function shortText(s: string) {
  if (s.length > FEEDBACK_TEXT_LIMIT) throw new Error('每项文字最多可填写 ' + FEEDBACK_TEXT_LIMIT + ' 字。');
  return s.trim();
}
export function checkedLabels(draft: ReviewLabels, suggestion: AdviceSnapshot | null): ReviewLabels {
  const comment = shortText(draft.comment);
  const replacement = draft.advice === 'rewrite' ? shortText(draft.replacement) : '';
  if (draft.accuracy === 'unrated' && draft.advice === 'unrated' && !comment) throw new Error('请先评价一项，或填写反馈说明。');
  if (draft.advice === 'usable' && !suggestion) throw new Error('此处没有已显示的建议可供评价。');
  if (draft.advice === 'rewrite' && !replacement) throw new Error('请填写你会给学生的建议。');
  return { accuracy: draft.accuracy, advice: draft.advice, comment, replacement };
}
export function reviewFinding(report: Report, finding: MarginFinding, labels: ReviewLabels, suggestion: AdviceSnapshot | null): ReviewedFinding {
  const { check, itemIndex, item } = finding;
  if (!report.checks.includes(check) || !Number.isInteger(itemIndex) || itemIndex < -1
      || (itemIndex === -1 ? !!item : !item || check.items[itemIndex] !== item)) throw new Error('批注位置已变化，请重新选择原文标记。');
  return { type: 'finding', key: findingFeedbackKey(report.id, check.rule.id, itemIndex), report: reportSource(report),
    updatedAt: new Date().toISOString(), rule: ruleReference(check.rule), itemIndex,
    evidence: { status: item?.status ?? check.status, executed: check.executed,
      location: item ? structuredClone(item.location) : undefined, observed: item?.observed, expected: item?.expected,
      reason: item ? item.reason : check.summary, formatSpan: item?.formatSpan ? { ...item.formatSpan } : undefined },
    reviewedAdvice: suggestion, labels: checkedLabels(labels, suggestion) };
}
export interface MissedDraft { position: string; ruleId: string; description: string }
export function reportMissed(report: Report, draft: MissedDraft): MissedFinding {
  const description = shortText(draft.description);
  if (!description) throw new Error('请描述原文中漏掉的问题。');
  const index = Number(draft.position);
  if (!/^\d+$/.test(draft.position.trim()) || !Number.isSafeInteger(index) || index < 1) throw new Error('请填写原文中的有效位置。');
  let location: Location;
  if (report.document.format === 'docx') {
    const paragraph = report.document.paragraphs.find(p => p.index === index);
    if (!paragraph) throw new Error('文档中没有这个源段号。');
    location = { paragraph: index, excerpt: paragraph.text.slice(0, 180) };
  } else {
    if (!report.document.pageCount || index > report.document.pageCount) throw new Error('页码超出当前 PDF 的范围。');
    location = { page: index };
  }
  const check = draft.ruleId ? report.checks.find(c => c.rule.id === draft.ruleId && c.status !== 'not_applicable') : null;
  if (draft.ruleId && !check) throw new Error('请选择本稿适用的规则。');
  return { type: 'missed', key: crypto.randomUUID(), report: reportSource(report), updatedAt: new Date().toISOString(),
    rule: check ? ruleReference(check.rule) : null, location, description };
}
export function saveFeedback(entries: FeedbackEntry[], record: FeedbackEntry) {
  const idx = entries.findIndex(e => e.key === record.key);
  if (idx >= 0) return entries.map((old, i) => i === idx ? record : old);
  if (entries.length >= FEEDBACK_LIMIT) throw new Error('本次会话已记录 ' + FEEDBACK_LIMIT + ' 条，请先导出并移除已保存的记录。');
  return [...entries, record];
}
export function feedbackExport(entries: FeedbackEntry[]) {
  return { schema: 'thesis-teacher-feedback/1', exportedAt: new Date().toISOString(),
    source: 'local_review', records: entries };
}

// A teacher's own wording, paired with the specific finding they confirmed.
// The document hash identifies a revision. Group related revisions together
// during dataset curation, before assigning any training or evaluation split.
export function teacherRewriteDraft(entries: FeedbackEntry[]) {
  const examples = entries.flatMap(entry => {
    if (entry.type !== 'finding' || entry.itemIndex < 0 || !entry.evidence.executed ||
        entry.labels.accuracy !== 'correct' || entry.labels.advice !== 'rewrite') return [];
    const rewrite = entry.labels.replacement.trim();
    if (!rewrite || !entry.evidence.location) return [];
    const { location, formatSpan, status, observed, expected, reason } = entry.evidence;
    const { fileHash, stage, kind, format, engine, ruleVersion } = entry.report;
    return [{
      documentVersion: fileHash, stage, kind, format, engine, ruleVersion, rule: entry.rule,
      itemIndex: entry.itemIndex, evidence: { status, observed, expected, reason,
        location: { page: location.page, paragraph: location.paragraph, section: location.section, objectId: location.objectId },
        selectedText: formatSpan?.text ?? location.excerpt, truncated: formatSpan?.truncated },
      teacherAdvice: rewrite,
    }];
  });
  return { schema: 'thesis-teacher-rewrite-draft/1', examples };
}
