import type { Paragraph, Rule, RulePack } from '../domain/types';
export const ZH = /[\u3400-\u9fff\uf900-\ufaff]/;
export const FRONT = new Set(['摘要', '中文摘要', 'abstract', '英文摘要', '目录', '指导小组成员名单', '指导小组名单', '学位论文原创性声明', '学位论文独创性声明', '原创性声明', '独创性声明', '学位论文使用授权声明', '学位论文授权使用声明', '授权使用声明', '授权声明', 'ai使用声明', '人工智能使用声明', '生成式人工智能使用声明']);
export const BACK = new Set(['参考文献', '附录', '致谢', '后记', ...[...FRONT].filter(x => !['摘要', '中文摘要', 'abstract', '英文摘要', '目录'].includes(x))]);
export function cleanTitle(text: string): string {
  return text.replace(/\s+/g, '').replace(/^第[〇零一二三四五六七八九十百\d]+[章节篇]/, '').replace(/^(?:[（(][〇零一二三四五六七八九十百\d]+[）)]|\d+(?:[.．]\d+)*[、.．]?|[一二三四五六七八九十]+[、.．])/, '').replace(/^[：:。．.]+|[：:。．.]+$/g, '').toLowerCase();
}
export function headingInfo(text: string, names: Set<string>, style = '', outline?: number | null): [boolean, number | null] {
  if (outline !== null && outline !== undefined && outline >= 0 && outline < 9) return [true, outline + 1];
  const styleMatch = /(?:heading|标题)\s*([1-9])/i.exec(style);
  if (styleMatch) return [true, Number(styleMatch[1])];
  if (text.length > 100) return [false, null];
  if (/^第[〇零一二三四五六七八九十百\d]+章\s*\S/.test(text)) return [true, 1];
  if (/^第[〇零一二三四五六七八九十百\d]+节\s*\S/.test(text)) return [true, 2];
  const numbered = /^(\d+(?:[.．]\d+)*)[、.．]?\s+\S/.exec(text);
  if (numbered) return [true, numbered[1].split(/[.．]/).length];
  return [names.has(cleanTitle(text)), null];
}
export function headingAliases(rule: Rule): string[] {
  const aliases = (rule.params.aliases || []).map(cleanTitle);
  if (rule.mode !== 'heading' || !rule.stages.includes('proposal')) return aliases;
  // Only vary the conjunction in a known full heading. A mention in prose is not a section.
  return aliases.flatMap(name => name.includes('与') ? ['与', '及', '和', '以及', '、'].map(joiner => name.replaceAll('与', joiner)) : [name]);
}
export function headingNames(pack: RulePack): Set<string> { return new Set([...FRONT, ...BACK, ...pack.rules.filter(r => r.mode === 'heading').flatMap(headingAliases)]); }
export function paragraph(index: number, text: string): Paragraph {
  return { index, text, runs: [], heading: false, level: null, toc: false, inTable: false, excluded: false, caption: false, lineRule: null, lineTwips: null };
}
export async function digest(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), x => x.toString(16).padStart(2, '0')).join('');
}
