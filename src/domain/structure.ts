import { cleanTitle, FRONT, BACK } from '../readers/shared';
import { locationOf, type AuditDocument, type Check, type CheckItem, type DocumentBlock, type ObjectEvidence, type ObjectReview, type Paragraph, type Rule, type Status, type StructureReview } from './types';

const NUMBER = /^([图表])\s*(\d+)\s*[-－—.．]\s*(\d+)\s*(.*)$/;
function chineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^(?:[一二三四五六七八九]|十[一二三四五六七八九]?|[一二三四五六七八九]十[一二三四五六七八九]?|[一二三四五六七八九]百(?:[零〇][一二三四五六七八九]|[一二三四五六七八九]十[一二三四五六七八九]?)?)$/.test(text)) return null;
  const digits = '零一二三四五六七八九'; let n = 0; let digit = 0;
  for (const c of text.replace(/〇/g, '零')) {
    if (digits.includes(c)) digit = digits.indexOf(c);
    else if (c === '十' || c === '百') { n += (digit || 1) * (c === '十' ? 10 : 100); digit = 0; }
    else return null;
  }
  return n + digit;
}
function chapters(doc: AuditDocument): Map<number, number | null> {
  const map = new Map<number, number | null>(); let chapter: number | null = null;
  for (const p of doc.paragraphs) {
    if (!p.toc && !p.inTable && !p.excluded && p.heading) {
      const explicit = /^第([〇零一二三四五六七八九十百\d]+)章\s*\S/.exec(p.text);
      const arabic = p.level === 1 ? /^(\d+)[、.．]?\s+\S/.exec(p.text) : null;
      if (explicit) chapter = chineseNumber(explicit[1]);
      else if (arabic) chapter = Number(arabic[1]);
      else if (p.level === 1 || FRONT.has(cleanTitle(p.text)) || BACK.has(cleanTitle(p.text))) chapter = null;
    }
    map.set(p.index, chapter && chapter > 0 && chapter < 1000 ? chapter : null);
  }
  return map;
}
export function reviewStructure(doc: AuditDocument): StructureReview {
  const scope = '仅对独立单张行内图片和非浮动、非嵌套的原生表格核对相邻题注的源文档顺序及可读分章编号；不证明实际分页、表内格式、图内文字或公式正确。';
  const review: StructureReview = { objects: [], orphanCaptions: [], scope };
  if (doc.format !== 'docx') return review;
  const ps = new Map(doc.paragraphs.map(p => [p.index, p]));
  const objects = new Map(doc.objects.filter(o => o.id).map(o => [o.id!, o]));
  const perParagraph = (index?: number) => doc.objects.filter(o => o.location.paragraph === index && o.kind !== 'table');
  const blocks = (doc.blocks || []).filter(b => b.kind !== 'paragraph' || Boolean(ps.get(b.paragraph)?.text || perParagraph(b.paragraph).length));
  const caption = (block: DocumentBlock | undefined, token: string): Paragraph | null => {
    const p = block?.kind === 'paragraph' ? ps.get(block.paragraph) : null;
    return p && p.caption && !p.inTable && !p.toc && !p.excluded && p.text.length <= 200 && !/[\r\n]/.test(p.text) && new RegExp(`^${token}\\s*\\d`).test(p.text) && perParagraph(p.index).length === 0 ? p : null;
  };
  const unstable = doc.limitations.some(l => ['revisions', 'hidden-text', 'hidden-object'].includes(l.code));
  const candidates: { object: ObjectEvidence; valid: Paragraph | null; reverse: Paragraph | null; index: number }[] = [];
  const pending = (object: ObjectEvidence, reason: string) => review.objects.push({ objectId: object.id!, relation: 'unresolved', position: 'manual', numbering: 'manual', reason });
  for (const object of doc.objects) {
    if (!object.id) continue;
    if (object.kind === 'formula' || object.kind === 'embedded') {
      review.objects.push({ objectId: object.id, relation: 'not_applicable', position: 'manual', numbering: 'manual', reason: object.kind === 'formula' ? '已发现并定位OMML公式；公式编号、符号排版与数学正确性未审核。' : '嵌入对象仅登记，内容未展开。' }); continue;
    }
    const index = blocks.findIndex(b => object.kind === 'table' ? b.kind === 'table' && b.objectId === object.id : b.kind === 'paragraph' && b.paragraph === object.location.paragraph);
    if (index < 0 || object.nested || object.hasNested || object.floating || object.hidden || unstable) { pending(object, unstable ? '存在修订或隐藏内容，先确认最终可见稿再核对题注。' : '对象为嵌套、浮动或未覆盖结构，题注关系需查看原稿。'); continue; }
    if (object.kind === 'image' && (!object.inline || object.grouped || perParagraph(object.location.paragraph).length !== 1 || ps.get(object.location.paragraph!)?.text)) { pending(object, '浮动、组合、多图、同段混排文字或其他绘图结构，未按独立单图推断题注。'); continue; }
    const token = object.kind === 'table' ? '表' : '图';
    const before = caption(blocks[index - 1], token); const after = caption(blocks[index + 1], token);
    candidates.push({ object, index, valid: object.kind === 'table' ? before : after, reverse: object.kind === 'table' ? after : before });
  }
  // A caption belonging to an object in the expected direction cannot be borrowed
  // by its neighbour in the opposite direction.
  const owners = new Map<number, number>();
  candidates.forEach(c => { if (c.valid) owners.set(c.valid.index, (owners.get(c.valid.index) || 0) + 1); });
  const reverseOwners = new Map<number, number>();
  candidates.forEach(c => { if (!c.valid && c.reverse && !owners.has(c.reverse.index)) reverseOwners.set(c.reverse.index, (reverseOwners.get(c.reverse.index) || 0) + 1); });
  const consumed = new Set<number>();
  for (const c of candidates) {
    const reverse = c.reverse && !owners.has(c.reverse.index) ? c.reverse : null;
    if (c.valid && reverse || c.valid && owners.get(c.valid.index) !== 1 || !c.valid && reverse && reverseOwners.get(reverse.index) !== 1) { pending(c.object, '前后存在多个候选题注或同一题注被多个对象共享，未唯一关联。'); continue; }
    const p = c.valid || reverse;
    if (!p || consumed.has(p.index)) { pending(c.object, '没有唯一可关联的相邻独立题注；不能据此认定缺少题注。'); continue; }
    consumed.add(p.index);
    const relation = p.index < (c.object.location.paragraph || Infinity) ? 'before' : 'after';
    review.objects.push({ objectId: c.object.id!, caption: locationOf(p), captionText: p.text, relation, position: c.valid ? 'pass' : 'fail', numbering: 'manual', reason: c.valid ? '题注与对象相邻，源文档顺序符合该项要求；实际分页仍需查看原稿。' : `源文档中${c.object.kind === 'table' ? '表题位于表后，应在表前' : '图题位于图前，应在图后'}；实际分页仍需查看原稿。` });
  }
  const context = chapters(doc); const previous = new Map<string, number>();
  const linked = review.objects.filter(r => r.caption).sort((a, b) => a.caption!.paragraph! - b.caption!.paragraph!);
  const parsed = linked.map(r => ({ r, match: NUMBER.exec(r.captionText || ''), chapter: context.get(objects.get(r.objectId)?.location.paragraph || 0) }));
  const duplicates = new Map<string, number>();
  for (const { match: m, chapter } of parsed) if (m && chapter) { const key = `${m[1]}:${chapter}:${Number(m[2])}:${Number(m[3])}`; duplicates.set(key, (duplicates.get(key) || 0) + 1); }
  for (const { r, match: m, chapter } of parsed) {
    if (!m || !chapter || !m[4].trim() || /^[.．\-－—]\s*\d/.test(m[4]) || !Number.isSafeInteger(Number(m[2])) || !Number.isSafeInteger(Number(m[3])) || Number(m[2]) < 1 || Number(m[3]) < 1) { r.numberReason = '分章编号、题注文字或所在章号不能可靠识别，保留人工确认。'; continue; }
    const group = `${m[1]}:${chapter}`; const number = Number(m[3]); const reasons: string[] = [];
    if (Number(m[2]) !== chapter) reasons.push(`编号章号${Number(m[2])}与可识别的所在章${chapter}不符`);
    if ((duplicates.get(`${m[1]}:${chapter}:${Number(m[2])}:${number}`) || 0) > 1) reasons.push('同章同类图表编号重复');
    if (Number(m[2]) === chapter) {
      if (number < (previous.get(group) || 0)) reasons.push('同章同类图表序号倒序');
      previous.set(group, Math.max(number, previous.get(group) || 0));
    }
    r.numbering = reasons.length ? 'fail' : 'pass'; r.numberReason = reasons.join('；') || '已核对可读章号及已关联同类题注的序号；未检查正文交叉引用或编号连续性。';
  }
  review.orphanCaptions = doc.paragraphs.filter(p => p.caption && !p.toc && !p.inTable && !p.excluded && /^[图表]\s*\d/.test(p.text) && !consumed.has(p.index)).map(locationOf);
  return review;
}

export function checkCaptions(doc: AuditDocument, rule: Rule, structure: StructureReview): Pick<Check, 'status' | 'summary' | 'items' | 'executed'> {
  if (doc.format !== 'docx' || !doc.blocks) return { status: 'manual', summary: '当前文档未提供可靠的Word图表块顺序，题注位置与编号保留人工核对。', items: [], executed: false };
  const byId = new Map(doc.objects.map(o => [o.id, o]));
  const relevant = structure.objects.filter(r => ['image', 'table'].includes(byId.get(r.objectId)?.kind || ''));
  const items: CheckItem[] = relevant.map(r => {
    const object = byId.get(r.objectId)!; const numbering = rule.mode === 'caption_number';
    return { location: r.caption ? { ...r.caption, objectId: r.objectId } : object.location, observed: r.captionText || object.detail,
      expected: numbering ? '按所在章分别编号，已关联的同类题注无重复或倒序' : object.kind === 'table' ? '表题在表前' : '图题在图后', status: numbering ? r.numbering : r.position, reason: numbering ? r.numberReason || r.reason : r.reason };
  });
  items.push(...structure.orphanCaptions.map(location => ({ location, observed: location.excerpt || '未关联题注', status: 'manual' as const, reason: '题注线索没有唯一关联的对象，本项未完成核对。' })));
  const failed = items.filter(i => i.status === 'fail').length; const unresolved = items.filter(i => i.status === 'manual').length;
  const status: Status = failed ? 'fail' : unresolved || !relevant.length ? 'manual' : 'pass';
  return { status, executed: true, summary: `发现${relevant.length}个图表对象，唯一关联${relevant.filter(r => r.caption).length}个题注；本项${failed}处明确偏差、${unresolved}处待确认。${structure.scope}`, items };
}
