import { publicAsset } from '../utils';
import type { AuditDocument, Check, CheckItem, MaterialKind, Paragraph, Report, RulePack, Settings, Stage, Status } from './types';
import { locationOf } from './types';
import { BACK, cleanTitle, digest, FRONT } from '../readers/shared';
import { checkTextFormat } from './textFormat';
import { checkFrontMatter } from './frontMatter';
import { checkCaptions, reviewStructure } from './structure';

export async function loadRules(): Promise<RulePack> {
  const r = await fetch(publicAsset('rules/college.json')); if (!r.ok) throw new Error('学院规则读取失败。');
  const pack = await r.json() as RulePack;
  if (!Array.isArray(pack.rules) || new Set(pack.rules.map(x => x.id)).size !== pack.rules.length) throw new Error('学院规则结构或编号无效。');
  const pdf = await fetch(publicAsset('rules/guide.pdf')); if (!pdf.ok || await digest(await pdf.arrayBuffer()) !== pack.source.sha256) throw new Error('规则依据PDF缺失或哈希不一致，停止检查。');
  return pack;
}
export function identifyBody(doc: AuditDocument, kind: MaterialKind): Paragraph[] {
  const eligible = doc.paragraphs.filter(p => p.text && !p.toc && !p.inTable && !p.excluded);
  const start = eligible.find(p => p.heading && !FRONT.has(cleanTitle(p.text)) && !BACK.has(cleanTitle(p.text)) && (p.level === 1 || ['绪论', '引言', '研究背景', '研究背景与意义'].includes(cleanTitle(p.text))));
  if (!start && kind === 'thesis') return [];
  const first = start?.index || eligible[0]?.index || 1;
  const ending = eligible.find(p => p.index > first && p.heading && BACK.has(cleanTitle(p.text)))?.index || Infinity;
  return eligible.filter(p => p.index >= first && p.index < ending && !p.heading && !p.caption);
}
function sectionHasContent(doc: AuditDocument, heading: Paragraph): boolean {
  for (const p of doc.paragraphs) {
    if (p.index <= heading.index || p.toc || p.excluded) continue;
    if (p.heading && (p.level || 1) <= (heading.level || 1)) return false;
    if (p.text) return true;
  }
  return false;
}
export function auditDocument(doc: AuditDocument, stage: Stage, kind: MaterialKind, pack: RulePack, settings: Settings): Report {
  if (stage === 'predefense' && kind !== 'thesis') throw new Error('预答辩请选择论文稿。');
  const started = performance.now(); const body = identifyBody(doc, kind);
  const complete = !doc.limitations.some(x => x.affectsPresence);
  const structure = reviewStructure(doc);
  const checks: Check[] = pack.rules.map(rule => {
    let status: Status = 'manual'; let summary = rule.note || '当前浏览器适配层尚未自动执行此项，需对照学院要求核实。'; let items: CheckItem[] = []; let executed = false;
    const emit = (s: Status, text: string, evidence: CheckItem[] = []) => { status = s; summary = text; items = evidence; executed = true; };
    if (!rule.stages.includes(stage) || (rule.params.kinds && !rule.params.kinds.includes(kind))) return { rule, status: 'not_applicable', summary: '本阶段或材料类型不应用此规则。', items: [], executed: false };
    if (settings.disabledRules.includes(rule.id)) return { rule, status: 'manual', summary: '本项被当前配置关闭，未执行检查；不能视为符合。', items: [], executed: false };
    if (['abstract_length', 'keywords', 'classification'].includes(rule.mode)) return { rule, ...checkFrontMatter(doc, rule) };
    if (['caption_position', 'caption_number'].includes(rule.mode)) return { rule, ...checkCaptions(doc, rule, structure) };
    if (rule.mode === 'page_size') {
      items = doc.sections.filter(s => s.width !== null && s.height !== null && (Math.abs(Math.min(s.width, s.height) - 210) > 1 || Math.abs(Math.max(s.width, s.height) - 297) > 1)).map(s => ({ location: { section: s.number, page: s.page }, observed: `${s.width?.toFixed(1)} × ${s.height?.toFixed(1)} mm`, expected: 'A4 210 × 297 mm', status: doc.format === 'pdf' ? 'warning' : 'fail' }));
      const unknown = !doc.sections.length || doc.sections.some(s => s.width === null || s.height === null);
      emit(items.length ? (doc.format === 'pdf' ? 'warning' : 'fail') : unknown ? 'manual' : 'pass', items.length ? (doc.format === 'pdf' ? 'PDF可见页面尺寸偏离A4；裁切框与实际纸张关系需核实。' : '发现非A4页面设置。') : unknown ? '未能完整读取页面尺寸。' : '已核对可读取的页面尺寸为A4。', items);
    } else if (['body_font', 'body_size', 'body_spacing', 'body_line'].includes(rule.mode)) {
      if (doc.format === 'pdf' && rule.mode !== 'body_size') { summary = '浏览器PDF读取尚不能可靠还原此项Word字体/段落设置，保留人工核对。'; }
      else {
        const bad: CheckItem[] = []; const unknown: CheckItem[] = []; let examined = 0;
        for (const p of body) {
          if (rule.mode === 'body_line') {
            examined++;
            if (p.lineRule !== 'exact' || p.lineTwips === null) unknown.push({ location: locationOf(p), observed: `${p.lineRule || '未确定'} / ${p.lineTwips ?? '未确定'}`, status: 'manual', reason: '未确定固定行距，不能等同20磅。' });
            else if (Math.abs(p.lineTwips / 20 - (rule.params.expected_pt || 20)) > .05) bad.push({ location: locationOf(p), observed: `固定 ${p.lineTwips / 20} 磅`, expected: `${rule.params.expected_pt} 磅`, status: 'fail' });
          } else {
            const inspected = checkTextFormat(p, rule, doc.format);
            examined += inspected.examined;
            for (const finding of inspected.findings) {
              (finding.status === 'manual' ? unknown : bad).push(finding);
            }
          }
        }
        emit(bad.length ? 'fail' : unknown.length || !examined ? 'manual' : 'pass', `核对${examined}个${rule.mode === 'body_line' ? '候选正文段落' : '候选正文中文片段'}：${bad.length}处偏差，${unknown.length}处未确定。`, [...bad, ...unknown]);
        if (doc.format === 'pdf') { if ((status as Status) === 'fail') status = 'warning'; else if ((status as Status) === 'pass') status = 'manual'; items = items.map(i => i.status === 'fail' ? { ...i, status: 'warning' } : i); summary += ' PDF正文范围由启发式推断，可能包含小标题、脚注或表格；仅作字号候选提示。'; }
      }
    } else if (rule.mode === 'heading') {
      const aliases = new Set((rule.params.aliases || []).map(cleanTitle));
      const found = doc.paragraphs.filter(p => p.heading && !p.toc && !p.inTable && !p.excluded && aliases.has(cleanTitle(p.text)));
      emit(found.some(p => sectionHasContent(doc, p)) ? 'pass' : 'manual', found.length ? '发现栏目标题线索；内容充分性、名称适配与真实性仍需教师确认。' : '未发现预设栏目线索；可能使用其他标题或另附材料，请核实。', found.map(p => ({ location: locationOf(p), observed: '栏目标题线索', status: sectionHasContent(doc, p) ? 'pass' : 'manual' })));
    } else if (rule.mode === 'ai_declaration') {
      const aliases = new Set(['ai使用声明', '人工智能使用声明', '生成式人工智能使用声明']);
      const found = doc.paragraphs.filter(p => p.heading && !p.toc && !p.excluded && !p.inTable && aliases.has(cleanTitle(p.text)));
      if (found.length) emit(found.some(p => sectionHasContent(doc, p)) ? 'pass' : 'manual', '发现声明栏目线索；实际使用范围、完整性与真实性需人工复核。', found.map(p => ({ location: locationOf(p), observed: '声明栏目', status: sectionHasContent(doc, p) ? 'pass' : 'manual' })));
      else {
        const mention = doc.paragraphs.some(p => !p.toc && /(?:AI|人工智能).{0,12}(?:使用|辅助)|(?:使用|借助).{0,10}(?:AI|人工智能)/i.test(p.text));
        emit(complete && !mention ? 'fail' : 'manual', complete && !mention ? '可读取材料中未检出独立AI使用声明，需按学院要求补充实际使用情况。' : '未确认独立声明；存在相关表述或未覆盖对象，不能据此认定材料缺失。');
      }
    } else if (['body_count', 'review_ratio'].includes(rule.mode)) { summary = '浏览器首版尚未确认完整统计范围与学院计数口径；不执行字数/综述比例阈值判断。'; }
    if (kind === 'report' && (status as Status) === 'fail' && (rule.mode.startsWith('body_') || rule.mode === 'page_size')) { status = 'warning'; summary += ' 阶段报告格式适用性待学院确认，本次仅提醒。'; items = items.map(i => i.status === 'fail' ? { ...i, status: 'warning' } : i); }
    return { rule, status, summary, items, executed };
  });
  return { id: crypto.randomUUID(), engine: 'browser-audit-0.7.0', stage, kind, createdAt: new Date().toISOString(), document: doc, ruleVersion: pack.version, checks, elapsedMs: performance.now() - started, steps: [], structure };
}
