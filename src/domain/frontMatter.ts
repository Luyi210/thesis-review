import { BACK, cleanTitle, FRONT } from '../readers/shared';
import { locationOf, type AuditDocument, type Check, type Paragraph, type Rule } from './types';

type Result = Pick<Check, 'status' | 'summary' | 'items' | 'executed'>;
interface Section { heading: Paragraph; content: Paragraph[]; complete: boolean }
function section(doc: AuditDocument, aliases: string[]): Section | null {
  const names = new Set(aliases.map(cleanTitle));
  const headings = doc.paragraphs.filter(p => p.heading && !p.toc && !p.inTable && !p.excluded && names.has(cleanTitle(p.text)));
  if (headings.length !== 1) return null;
  const heading = headings[0]; const content: Paragraph[] = []; let bounded = false;
  for (const p of doc.paragraphs) {
    if (p.index <= heading.index || p.toc || p.excluded) continue;
    const name = cleanTitle(p.text);
    if (p.heading && ((p.level || 1) <= (heading.level || 1) || FRONT.has(name) || BACK.has(name))) { bounded = true; break; }
    if (p.text) content.push(p);
  }
  const unhandled = doc.limitations.some(l => l.affectsPresence) || content.some(p => p.inTable || p.heading);
  return { heading, content, complete: bounded && !unhandled };
}
const manual = (summary: string): Result => ({ status: 'manual', summary, items: [], executed: true });

export function checkFrontMatter(doc: AuditDocument, rule: Rule): Result {
  if (doc.format !== 'docx') return manual('PDF的摘要范围与分行尚未可靠还原，此项保留人工核对。');
  const zh = section(doc, ['摘要', '中文摘要']);
  if (rule.mode === 'classification') {
    const en = section(doc, ['abstract', '英文摘要']);
    const sections = [{ name: '中文摘要', value: zh, pattern: /中图分类号\s*[:：]?\s*[A-Z]\d[\d.\-/]*/i }, { name: '英文摘要', value: en, pattern: /(?:\bCLC\b|中图分类号)\s*[:：]?\s*[A-Z]\d[\d.\-/]*/i }];
    const items = sections.flatMap(s => s.value?.content.filter(p => !p.inTable && s.pattern.test(p.text)).map(p => ({ location: locationOf(p), observed: `${s.name}：${p.text.match(s.pattern)![0]}`, status: 'pass' as const })) || []);
    const missing = sections.filter(s => !s.value || !s.value.content.some(p => !p.inTable && s.pattern.test(p.text))).map(s => s.name);
    return { status: missing.length ? 'manual' : 'pass', summary: missing.length ? `未能确认${missing.join('、')}的分类号线索，请核实位置或写法；不认定分类内容正确。` : '发现中英文摘要的分类号线索；未验证分类是否准确，也不强制使用模板示例编号。', items, executed: true };
  }
  if (!zh) return manual('中文摘要标题无法唯一定位，不能据此统计摘要或关键词。');
  if (!zh.complete) return manual('摘要范围未闭合，或文件包含未覆盖的图像、修订、表格等内容；此项统计保留人工确认。');
  if (rule.mode === 'keywords') {
    const lines = zh.content.flatMap(p => p.text.split(/\r?\n/).map(text => ({ paragraph: p, text: text.trim() }))).filter(x => /^(?:关键词|关键字)\s*[:：]/.test(x.text));
    if (lines.length !== 1) return manual('未发现唯一、独立的中文关键词行；请核实其他写法或换行布局。');
    const { paragraph: p, text } = lines[0]; const raw = text.replace(/^(?:关键词|关键字)\s*[:：]\s*/, '').trim();
    if (p.text.split(/\r?\n/).filter(t => t.trim()).length !== 1 || zh.content.some(next => next.index > p.index && !/^中图分类号\s*[:：]/.test(next.text))) return manual('关键词可能跨段、跨行或与其他正文相连，未按单行数量作结论。');
    if (!/[;；、]/.test(raw) || /[,，\n]|(?:中图分类号|CLC)\s*[:：]/i.test(raw)) return manual('关键词分隔方式或行内范围不明确；当前只自动统计分号、顿号清楚分隔的独立行。');
    const words = raw.split(/[;；、]/).map(x => x.trim());
    if (words.some(w => !w || /[。.!！?？:：]/.test(w)) || new Set(words).size !== words.length) return manual('关键词中存在空项、重复项或疑似合并文本，请先人工确认关键词边界。');
    const n = words.length; const low = rule.params.minimum!; const high = rule.params.maximum!;
    const status = n >= low && n <= high ? 'pass' : 'fail';
    return { status, summary: `按明确分隔符识别到${n}个中文关键词；只核对数量，不判断词语是否反映论文核心内容。`, items: [{ location: locationOf(p), observed: `${n}个：${words.join('；')}`, expected: `${low}–${high}个`, status }], executed: true };
  }
  const paragraphs: Paragraph[] = [];
  for (const p of zh.content) {
    if (/^(?:关键词|关键字|中图分类号)\s*[:：]/.test(p.text)) break;
    if (/(?:关键词|关键字|中图分类号)\s*[:：]/.test(p.text)) return manual('摘要正文与关键词或分类号合在同一段，统计边界需人工核实。');
    paragraphs.push(p);
  }
  const text = paragraphs.map(p => p.text).join('\n');
  const n = (text.match(/[\u3400-\u9fff\uf900-\ufaff]|[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
  if (!n) return manual('没有可可靠统计的中文摘要正文。');
  const low = rule.params.minimum!; const high = rule.params.maximum!;
  const status = n >= low && n <= high ? 'pass' : 'warning';
  return { status, summary: `按试验口径估算中文摘要${n}个文字单位：汉字逐字、连续英文/数字词计1，忽略标点空白；不等同Word字数。${low}–${high}是通常建议，不能据此认定论文不合格。`, items: [{ location: locationOf(paragraphs[0]), observed: `试验估算${n}个文字单位`, expected: `通常${low}–${high}字，口径待教师确认`, status }], executed: true };
}
