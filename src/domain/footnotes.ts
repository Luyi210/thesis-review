import { locationOf, type AuditDocument, type Check, type CheckItem, type Paragraph } from './types';

type FootnoteMarker = {
  observed: string; expected: string; number: number; fullwidth: boolean;
};

// Require a standalone numeric label followed by prose. Dates, ranges, and citations
// inside a sentence cannot establish the style of a footnote label.
export function footnoteMarker(text: string): FootnoteMarker | undefined {
  const match = /^([\[［]?)([0-9０-９]{1,4})([\]］]?)(\s*)(?=\p{L})/u.exec(text);
  if (!match) return;
  const [, opening, digits, closing, gap] = match;
  if ((!opening && !closing) || (!closing && (!gap || /^(?:至|到|to |and )\s*[0-9０-９]/iu.test(text.slice(match[0].length))))) return;
  const fullwidth = opening === '［' || closing === '］';
  const left = fullwidth ? '［' : '[';
  const right = fullwidth ? '］' : ']';
  if ((opening && opening !== left) || (closing && closing !== right)) return;
  return { observed: opening + digits + closing, expected: left + digits + right,
    number: Number(digits.normalize('NFKC')), fullwidth };
}

type Label = FootnoteMarker & { line: Paragraph };
type Result = Omit<Check, 'rule'>;
export function checkFootnoteBrackets(doc: AuditDocument): Result {
  if (doc.format !== 'pdf') return { status: 'not_applicable', summary: '此项读取 PDF 原生页脚。', executed: false, items: [] };
  const labels: Label[] = [];
  for (const line of doc.paragraphs) {
    if (line.pdfRegion !== 'footnote' || line.inTable || line.toc || line.caption || line.heading
      || !line.page || line.bbox?.length !== 4 || !line.runs.length || line.runs.some(r => r.size == null)) continue;
    const marker = footnoteMarker(line.text);
    if (marker) labels.push({ ...marker, line });
  }

  const items: CheckItem[] = [];
  let checked = 0;
  for (let start = 0; start < labels.length;) {
    // A complete label corroborates only a continuous series in the same style
    // on this page or consecutive pages. Repeated or restarted numbering splits the series.
    let end = start + 1;
    while (end < labels.length && labels[end].number === labels[end - 1].number + 1
      && labels[end].fullwidth === labels[start].fullwidth
      && labels[end].line.page! - labels[end - 1].line.page! <= 1) end++;
    const series = labels.slice(start, end);
    const witness = series.find(label => label.observed === label.expected);
    if (witness) {
      checked += series.length;
      for (const label of series) {
        if (label.observed === label.expected) continue;
        const location = locationOf(label.line);
        if (label.line.pdfMarkerBox) location.bbox = label.line.pdfMarkerBox;
        items.push({ location, observed: label.observed, expected: label.expected, status: 'warning',
          reason: `同稿第 ${witness.line.page} 页的脚注编号 ${witness.observed} 使用成对方括号。` });
      }
    }
    start = end;
  }
  if (!checked) return { status: 'manual', executed: false, summary: '没有可用来对照的 PDF 原生脚注编号。', items: [] };
  return { status: items.length ? 'warning' : 'pass', executed: true, items,
    summary: `核对了 ${checked} 个可定位的脚注编号，其中 ${items.length} 处缺少方括号。` };
}
