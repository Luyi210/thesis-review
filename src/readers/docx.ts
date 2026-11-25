import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import type { AuditDocument, DocumentBlock, Limitation, ObjectEvidence, RulePack, Run } from '../domain/types';
import { digest, headingInfo, headingNames, paragraph } from './shared';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const all = (node: Element | Document, name: string, ns = W) => Array.from(node.getElementsByTagNameNS(ns, name));
const child = (node: Element | null | undefined, name: string, ns = W): Element | null => node ? Array.from(node.childNodes).find(n => n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === name) as Element || null : null;
const attr = (node: Element | null, name: string, fallback: string | null = null) => node?.hasAttributeNS(W, name) ? node.getAttributeNS(W, name) : fallback;
const num = (s: string | null | undefined) => s !== null && s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
const hasAncestor = (node: Node, names: string[]) => { let p = node.parentNode; while (p) { if ((p as Element).namespaceURI === W && names.includes((p as Element).localName || '')) return true; p = p.parentNode; } return false; };
interface RProps { eastAsia?: string; theme?: string; size?: number | null; spacing?: number | null; hidden?: boolean; complexScript?: boolean; rtl?: boolean; origin?: string }
interface PProps { outline?: number | null; lineRule?: string | null; line?: number | null; align?: string | null }

class StyleResolver {
  nodes = new Map<string, Element>(); defaultStyle: string | null = null; defaults: Element | null;
  private eastAsianThemeFonts = new Map<string, string>();
  constructor(styles: Document, theme?: Document, settings?: Document) {
    for (const s of all(styles, 'style')) {
      this.nodes.set(attr(s, 'styleId') || '', s);
      if (attr(s, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(attr(s, 'default') || '')) this.defaultStyle = attr(s, 'styleId');
    }
    this.defaults = all(styles, 'docDefaults')[0] || null;
    if (!theme) return;
    // ISO 29500 themeFontLang selects the theme script for the document.
    // w:lang on individual runs is for proofing and does not select a theme font.
    const lang = attr(settings ? child(settings.documentElement, 'themeFontLang') : null, 'eastAsia')?.toLowerCase();
    let script: string | undefined;
    if (lang) {
      if (/^zh-(hans|cn|sg)(-|$)/.test(lang)) script = 'Hans';
      else if (/^zh-(hant|tw|hk|mo)(-|$)/.test(lang)) script = 'Hant';
      else if (/^ja(-|$)/.test(lang)) script = 'Jpan';
      else if (/^ko(-|$)/.test(lang)) script = 'Hang';
      else return; // Unknown language-to-script mapping stays manual.
    }
    for (const weight of ['major', 'minor']) {
      const family = all(theme, weight + 'Font', A)[0];
      if (!family) continue;
      const matched = script ? all(family, 'font', A).find(f => f.getAttribute('script') === script) : null;
      const face = matched?.getAttribute('typeface') || child(family, 'ea', A)?.getAttribute('typeface');
      if (face) this.eastAsianThemeFonts.set(weight + 'EastAsia', face);
    }
  }
  chain(id: string | null): Element[] {
    const seen = new Set<string>(); const result: Element[] = [];
    while (id && this.nodes.has(id) && !seen.has(id)) { seen.add(id); const s = this.nodes.get(id)!; result.unshift(s); id = attr(child(s, 'basedOn'), 'val'); }
    return result;
  }
  runProps(state: RProps, node: Element | null, origin: string) {
    if (!node) return;
    const fonts = child(node, 'rFonts'); const literal = attr(fonts, 'eastAsia'); const theme = attr(fonts, 'eastAsiaTheme');
    if (literal || theme) { state.eastAsia = literal || undefined; state.theme = theme || undefined; state.origin = origin; }
    const size = child(node, 'sz'); const spacing = child(node, 'spacing');
    if (size) state.size = num(attr(size, 'val'));
    if (spacing) state.spacing = num(attr(spacing, 'val'));
    const hidden = child(node, 'vanish');
    if (hidden) { const enabled = !['0', 'false', 'off'].includes((attr(hidden, 'val', '1') || '').toLowerCase()); if (origin.startsWith('style:')) { if (enabled) state.hidden = !state.hidden; } else state.hidden = enabled; }
    for (const key of ['cs', 'rtl'] as const) {
      const setting = child(node, key);
      if (setting) state[key === 'cs' ? 'complexScript' : 'rtl'] = !['0', 'false', 'off'].includes(attr(setting, 'val', '1') || '');
    }
  }
  paraProps(state: PProps, node: Element | null) {
    if (!node) return;
    const line = child(node, 'spacing');
    if (line && attr(line, 'line') !== null) { state.line = num(attr(line, 'line')); state.lineRule = attr(line, 'lineRule', 'auto'); }
    const outline = child(node, 'outlineLvl'); if (outline) state.outline = num(attr(outline, 'val'));
    const align = child(node, 'jc'); if (align) state.align = attr(align, 'val');
  }
  paragraph(el: Element) {
    const direct = child(el, 'pPr'); const styleId = attr(child(direct, 'pStyle'), 'val', this.defaultStyle);
    const runs: RProps = {}; const paras: PProps = {};
    this.runProps(runs, child(child(this.defaults, 'rPrDefault'), 'rPr'), 'docDefaults');
    this.paraProps(paras, child(child(this.defaults, 'pPrDefault'), 'pPr'));
    for (const s of this.chain(styleId)) { this.runProps(runs, child(s, 'rPr'), `style:${attr(s, 'styleId')}`); this.paraProps(paras, child(s, 'pPr')); }
    this.paraProps(paras, direct);
    return { runs, paras, name: attr(child(this.nodes.get(styleId || ''), 'name'), 'val', styleId || '') || '' };
  }
  run(el: Element, base: RProps): Run | null {
    const props = { ...base }; const direct = child(el, 'rPr');
    for (const s of this.chain(attr(child(direct, 'rStyle'), 'val'))) this.runProps(props, child(s, 'rPr'), `style:character:${attr(s, 'styleId')}`);
    this.runProps(props, direct, 'direct'); if (props.hidden) return null;
    const text = Array.from(el.getElementsByTagName('*')).filter(t => t.namespaceURI === W && ['t', 'tab', 'br', 'cr'].includes(t.localName) && !hasAncestor(t, ['del', 'moveFrom', 'txbxContent'])).map(t => t.localName === 't' ? t.textContent || '' : t.localName === 'tab' ? '\t' : '\n').join('');
    // A forced complex-script run uses separate cs/szCs properties. Ordinary
    // eastAsia/sz values cannot establish the displayed font or size here.
    const complex = props.complexScript || props.rtl;
    const face = props.theme ? this.eastAsianThemeFonts.get(props.theme) : props.eastAsia;
    return { text, font: complex ? null : face || null,
      size: complex || props.size == null || props.size <= 0 ? null : props.size / 2,
      spacing: props.spacing === undefined ? 0 : props.spacing, origin: props.origin || 'OOXML resolved' };
  }
}

export async function readDocx(buffer: ArrayBuffer, name: string, pack: RulePack): Promise<AuditDocument> {
  let expanded = 0;
  const wanted = new Set(['word/document.xml', 'word/styles.xml', 'word/theme/theme1.xml', 'word/settings.xml']);
  const files = unzipSync(new Uint8Array(buffer), { filter: f => {
    expanded += f.originalSize;
    if (expanded > 200 * 1024 * 1024) throw new Error('DOCX 展开大小超过200 MiB。');
    if (wanted.has(f.name) && f.originalSize > 8 * 1024 * 1024) throw new Error('DOCX XML部件过大。');
    return wanted.has(f.name);
  } });
  const parse = (key: string, optional = false) => {
    if (!files[key]) { if (!optional) throw new Error(`DOCX缺少必要部件：${key}`); return new DOMParser().parseFromString(`<w:styles xmlns:w="${W}"/>`, 'text/xml'); }
    const xml = strFromU8(files[key]);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不读取含DTD或自定义实体的XML。');
    let failed = false;
    const result = new DOMParser({ errorHandler: { warning: () => { failed = true; }, error: () => { failed = true; }, fatalError: () => { failed = true; } } }).parseFromString(xml, 'text/xml');
    if (failed) throw new Error(`DOCX XML格式无法可靠读取：${key}`);
    return result;
  };
  const root = parse('word/document.xml');
  const styles = new StyleResolver(parse('word/styles.xml', true),
    files['word/theme/theme1.xml'] ? parse('word/theme/theme1.xml') : undefined,
    files['word/settings.xml'] ? parse('word/settings.xml') : undefined);
  const body = all(root, 'body')[0]; if (!body) throw new Error('没有找到DOCX正文。');
  const limitations: Limitation[] = []; const objects: ObjectEvidence[] = []; const names = headingNames(pack);
  const limitationsByCode = new Map<string, Limitation>();
  const limit = (code: string, message: string, affectsPresence = true) => limitationsByCode.set(code, { code, message, affectsPresence });
  if (all(body, 'ins').length || all(body, 'del').length || all(body, 'moveFrom').length) limit('revisions', '存在修订内容，请先确认最终稿视图；未自动接受修订。');
  if (all(body, 'txbxContent').length) limit('textboxes', '文本框未纳入普通正文检查或材料缺失判定。');
  if (all(body, 'altChunk').length) limit('external-content', '嵌入的外部内容未展开。');
  if (all(body, 'footnoteReference').length || all(body, 'endnoteReference').length) limit('notes', '脚注尾注未纳入普通正文格式检查。', false);
  if (all(body, 'headerReference').length || all(body, 'footerReference').length) limit('header-footer', '页眉页脚未纳入主文档文字与对象清单；不能据此判断全文材料缺失。');
  const ps = all(body, 'p').filter(p => !hasAncestor(p, ['txbxContent', 'del', 'moveFrom']));
  const fields: { instruction: string; paragraphs: Set<number> }[] = [];
  const tocParagraphs = new Set<number>();
  const markField = (field: { instruction: string; paragraphs: Set<number> }) => {
    if (/\bTOC\b/i.test(field.instruction)) field.paragraphs.forEach(i => tocParagraphs.add(i));
  };
  ps.forEach((el, i) => {
    fields.forEach(f => f.paragraphs.add(i));
    for (const n of Array.from(el.getElementsByTagName('*')).filter(n => n.namespaceURI === W)) {
      if (n.localName === 'fldChar' && attr(n, 'fldCharType') === 'begin') fields.push({ instruction: '', paragraphs: new Set([i]) });
      if (n.localName === 'instrText' && fields.length) fields[fields.length - 1].instruction += n.textContent || '';
      if (n.localName === 'fldSimple' && /\bTOC\b/i.test(attr(n, 'instr') || '')) tocParagraphs.add(i);
      if (n.localName === 'fldChar' && attr(n, 'fldCharType') === 'end') { const field = fields.pop(); if (field) markField(field); }
    }
  });
  fields.forEach(markField);
  const paragraphs = ps.map((el, index) => {
    const base = styles.paragraph(el); const runs: Run[] = [];
    for (const r of all(el, 'r').filter(r => !hasAncestor(r, ['txbxContent', 'del', 'moveFrom']))) { const info = styles.run(r, base.runs); if (info) runs.push(info); else if (all(r, 't').some(t => t.textContent?.trim())) limit('hidden-text', '存在隐藏文字，常规视图内容与打印/显示设置需人工确认。'); }
    const text = runs.map(r => r.text).join('').trim(); const p = paragraph(index + 1, text); p.runs = runs;
    p.previewText = Array.from(el.getElementsByTagName('*')).filter(n => n.localName === 't' && [W, M].includes(n.namespaceURI || '') && !hasAncestor(n, ['del', 'moveFrom', 'txbxContent'])).map(n => n.textContent || '').join('');
    p.inTable = hasAncestor(el, ['tc']); p.lineRule = base.paras.lineRule || null; p.lineTwips = base.paras.line ?? null;
    [p.heading, p.level] = headingInfo(text, names, base.name, base.paras.outline);
    const sdt = (() => { let n: Node | null = el; while (n) { if (n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === 'sdt') return n as Element; n = n.parentNode; } return null; })();
    const gallery = sdt ? all(sdt, 'docPartGallery').some(x => /^(目录|table of contents)$/i.test(attr(x, 'val', '') || '')) : false;
    p.toc = tocParagraphs.has(index) || gallery || /^(?:toc\s*\d|目录\s*\d)/i.test(base.name) || /[.．·…]{3,}\s*[\divxlcdm]+$/i.test(text);
    p.caption = /caption|题注|图题|表题/i.test(base.name) || (/^[图表]\s*\d+\s*[-－—.．]\s*\d+/.test(text) && base.paras.align === 'center');
    let objectIndex = 0;
    const hiddenObject = (node: Element) => { let r: Node | null = node.parentNode; while (r && r !== el) { if ((r as Element).namespaceURI === W && (r as Element).localName === 'r') return styles.run(r as Element, base.runs) === null; r = r.parentNode; } return false; };
    for (const d of [...all(el, 'drawing'), ...all(el, 'pict')].filter(d => !hasAncestor(d, ['del', 'moveFrom', 'txbxContent']))) {
      const id = `image-p${p.index}-${++objectIndex}`;
      const inline = all(d, 'inline', WP).length === 1 && all(d, 'anchor', WP).length === 0 && all(d, 'blip', A).length === 1;
      const grouped = Array.from(d.getElementsByTagName('*')).some(n => ['grpSp', 'wgp', 'group'].includes(n.localName)) || hasAncestor(d, ['object']);
      const hidden = hiddenObject(d);
      objects.push({ id, kind: 'image', inline, grouped, hidden, nested: p.inTable, location: { paragraph: p.index, excerpt: text.slice(0, 120), objectId: id }, detail: inline ? '原生行内图片；图内文字未识别' : '浮动、VML或其他绘图对象；实际版面关系待核对' });
      if (hidden) limit('hidden-object', '存在隐藏绘图对象，显示状态与题注关系需人工确认。');
      limit('image-content', '检测到图片或绘图对象；图内文字、组合关系和复杂题注需人工核对。');
    }
    let mathIndex = 0;
    for (const math of all(el, 'oMath', M).filter(m => !hasAncestor(m, ['del', 'moveFrom', 'txbxContent']))) {
      const id = `formula-p${p.index}-${++mathIndex}`;
      objects.push({ id, kind: 'formula', nested: p.inTable, location: { paragraph: p.index, objectId: id, excerpt: all(math, 't', M).map(x => x.textContent || '').join('').slice(0, 120) }, detail: '检测到原生OMML公式对象；仅定位，未审核符号排版或数学正确性' });
      limit('formulas', '原生公式对象已发现，未还原为完整LaTeX或套用普通正文字体规则。', false);
    }
    let embeddedIndex = 0;
    for (const embedded of all(el, 'object').filter(o => !hasAncestor(o, ['del', 'moveFrom', 'txbxContent']))) { const id = `embedded-p${p.index}-${++embeddedIndex}`; objects.push({ id, kind: 'embedded', nested: p.inTable, hidden: hiddenObject(embedded), location: { paragraph: p.index, objectId: id }, detail: '嵌入对象，可能包含MathType等内容；尚未展开' }); limit('embedded', '存在未展开嵌入对象，不作全文材料缺失结论。'); }
    return p;
  });
  const tableIds = new Map<Element, string>();
  for (const table of all(body, 'tbl').filter(t => !hasAncestor(t, ['del', 'moveFrom', 'txbxContent']))) {
    const id = `table-${tableIds.size + 1}`; tableIds.set(table, id);
    const first = all(table, 'p')[0]; const index = first ? ps.indexOf(first) + 1 : undefined;
    const rows = all(table, 'tr').length; const merged = all(table, 'gridSpan').length + all(table, 'vMerge').length;
    objects.push({ id, kind: 'table', nested: hasAncestor(table, ['tbl']), hasNested: all(table, 'tbl').length > 0, floating: all(table, 'tblpPr').length > 0, rows, merged, location: { paragraph: index || undefined, objectId: id }, detail: `原生表格：${rows}个行标记、${merged}个合并标记；未检查表内格式、三线表与跨页关系` });
    limit('tables', '读取了原生表格及合并标记；表格内部格式、三线表及跨页关系尚未执行。', false);
  }
  const paragraphIds = new Map(ps.map((el, i) => [el, i + 1])); const blocks: DocumentBlock[] = [];
  const walkBlocks = (parent: Element) => {
    for (const n of Array.from(parent.childNodes).filter(n => n.nodeType === 1) as Element[]) {
      if (n.namespaceURI !== W) { blocks.push({ kind: 'unsupported' }); continue; }
      if (n.localName === 'p') { const paragraph = paragraphIds.get(n); if (paragraph) blocks.push({ kind: 'paragraph', paragraph }); }
      else if (n.localName === 'tbl') { const objectId = tableIds.get(n); if (objectId) blocks.push({ kind: 'table', objectId }); }
      else if (['sdt', 'sdtContent', 'customXml', 'ins', 'moveTo'].includes(n.localName)) walkBlocks(n);
      else if (!['sectPr', 'sdtPr', 'sdtEndPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'del', 'moveFrom'].includes(n.localName)) blocks.push({ kind: 'unsupported' });
    }
  };
  walkBlocks(body);
  let prior: { width: number | null; height: number | null } = { width: null, height: null };
  const sections = all(body, 'sectPr').map((s, i) => { const size = child(s, 'pgSz'); if (size) prior = { width: num(attr(size, 'w')), height: num(attr(size, 'h')) }; return { number: i + 1, width: prior.width === null ? null : prior.width / 1440 * 25.4, height: prior.height === null ? null : prior.height / 1440 * 25.4 }; });
  limitations.push(...limitationsByCode.values(), { code: 'browser-docx-scope', message: '浏览器首版核对已支持的普通中文正文属性；原生图表公式证据已列出，未完成复杂对象自动审核。', affectsPresence: false }, { code: 'word-preview', message: 'Word为浏览器布局预览，实际字体替换与分页以Word/WPS为准；定位不猜实际页码。', affectsPresence: false });
  if (paragraphs.length > 20000) throw new Error('DOCX段落数量超过试验上限。');
  return { name, format: 'docx', sha256: await digest(buffer), bytes: buffer.byteLength, paragraphs, sections, objects, limitations, blocks };
}
