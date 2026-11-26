import { publicAsset } from '../utils';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { getDocument, GlobalWorkerOptions, OPS, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AuditDocument, Limitation, Paragraph, RulePack } from '../domain/types';
import { footnoteMarker } from '../domain/footnotes';
import { cleanTitle, digest, headingInfo, headingNames, paragraph } from './shared';
import { markPageZones, markRunningMargins, type PageBoundary } from './pdfBodyZones';
import { pageMarks } from './pdfGraphics';

GlobalWorkerOptions.workerSrc = workerUrl;
export async function openPdf(buffer: ArrayBuffer): Promise<PDFDocumentProxy> {
  const options = { data: new Uint8Array(buffer.slice(0)), cMapUrl: publicAsset('pdf-assets/cmaps/'), cMapPacked: true,
    standardFontDataUrl: publicAsset('pdf-assets/standard_fonts/'), wasmUrl: publicAsset('pdf-assets/wasm/'), isEvalSupported: false, useSystemFonts: true };
  const task = getDocument(options);
  task.onPassword = () => { void task.destroy(); };
  try { return await task.promise; } catch { throw new Error('PDF无法读取，请确认文件完整且没有打开密码。'); }
}
function union(a: number[], b: number[]) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }

export async function readPdf(buffer: ArrayBuffer, name: string, pack: RulePack, progress?: (text: string) => void): Promise<AuditDocument> {
  const pdf = await openPdf(buffer); const paragraphs: Paragraph[] = []; const sections: AuditDocument['sections'] = [];
  const limitations: Limitation[] = [{ code: 'pdf-structure', message: 'PDF按原生文字行定位；Word行距、字距、图表题注、公式及完整字数边界尚未还原。', affectsPresence: true }];
  const names = headingNames(pack); let total = 0;
  const pages: PageBoundary[] = [];
  try {
    if (pdf.numPages > 300) throw new Error('PDF超过300页试验上限。');
    for (let number = 1; number <= pdf.numPages; number++) {
      progress?.(`读取 PDF 第 ${number} / ${pdf.numPages} 页`);
      const page = await pdf.getPage(number); const viewport = page.getViewport({ scale: 1 });
      sections.push({ number, page: number, width: viewport.width / 72 * 25.4, height: viewport.height / 72 * 25.4 });
      const content = await page.getTextContent();
      const items = content.items.filter((x): x is TextItem => 'str' in x && Boolean(x.str.trim()));
      total += items.reduce((n, x) => n + x.str.length, 0);
      if (total > 600000 || items.length > 30000) throw new Error('PDF文字量超过浏览器试验上限。');
      const lines: { item: TextItem; bbox: number[]; size: number; upright: boolean }[][] = [];
      for (const item of items) {
        const t = item.transform; const size = Math.hypot(t[2], t[3]) * page.userUnit;
        const upright = page.rotate % 360 === 0 && Math.abs(t[1]) < .01 && Math.abs(t[2]) < .01;
        const rect = viewport.convertToViewportRectangle([t[4], t[5] - size / page.userUnit * .2, t[4] + item.width, t[5] + size / page.userUnit * .85]);
        const bbox = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
        const record = { item, bbox, size, upright };
        let target = lines.find(line => Math.abs(line[0].bbox[1] - bbox[1]) < 2 && line[0].upright === upright);
        if (!target) { target = []; lines.push(target); }
        target.push(record);
      }
      lines.sort((a, b) => a[0].bbox[1] - b[0].bbox[1]);
      const pageParagraphs: Paragraph[] = [];
      for (const line of lines) {
        line.sort((a, b) => a.bbox[0] - b.bbox[0]);
        const wideGap = line.some((r, i) => i > 0 && r.bbox[0] - line[i - 1].bbox[2] > 36);
        const text = line.map((r, i) => (i && /[A-Za-z0-9]$/.test(line[i - 1].item.str) && /^[A-Za-z0-9]/.test(r.item.str) ? ' ' : '') + r.item.str).join('').trim();
        const p = paragraph(paragraphs.length + 1, text); p.page = number; p.bbox = line.map(r => r.bbox).reduce(union);
        p.runs = line.map(r => ({ text: r.item.str, font: null, size: r.upright && !wideGap && Number.isFinite(r.size) ? r.size : null, spacing: null, origin: 'PDF原生文字几何；字体名称未可靠还原' }));
        [p.heading, p.level] = headingInfo(text, names);
        if (p.heading && p.level === null) p.level = 1;
        if (wideGap || !line.every(r => r.upright)) { p.heading = false; limitations.push({ code: 'pdf-complex-layout', message: `PDF第${number}页存在大间隔或旋转文字，可能为分栏/无框线表格，范围需核实。`, affectsPresence: true, page: number }); }
        if ((p.bbox[1] < 35 || p.bbox[3] > viewport.height - 35) && /^[-—\s]*\d+[-—\s]*$/.test(text)) {
          p.excluded = true; p.pdfRegion = 'running';
        }
        paragraphs.push(p); pageParagraphs.push(p);
      }
      const leaders = pageParagraphs.filter(p => /[.．·…]{3,}\s*[\divxlcdm]+$/i.test(p.text));
      const toc = leaders.length >= 2 || (leaders.length > 0 && pageParagraphs.some(p => cleanTitle(p.text) === '目录'));
      if (toc) pageParagraphs.forEach(p => { p.toc = true; });
      if (!items.length) limitations.push({ code: 'pdf-textless', message: `第${number}页无原生文字；网页扫描OCR尚未接入，不能据此判定材料缺失。`, affectsPresence: true, page: number });
      const operators = await page.getOperatorList();
      markPageZones(pageParagraphs, pageMarks(operators, viewport.transform), viewport.width, viewport.height);
      // A PDF text item may include both the number and its citation. Never infer
      // a character width inside such an item; retain the line anchor in that case.
      for (const [i, p] of pageParagraphs.entries()) {
        if (p.pdfRegion !== 'footnote') continue;
        const marker = footnoteMarker(p.text);
        if (!marker || marker.observed === marker.expected) continue;
        let prefix = '';
        let box: number[] | undefined;
        for (const r of lines[i]) {
          prefix += r.item.str;
          const selected = prefix.trim();
          if (!marker.observed.startsWith(selected)) break;
          box = box ? union(box, r.bbox) : r.bbox;
          if (selected === marker.observed) { p.pdfMarkerBox = box; break; }
        }
      }
      pages.push({ paragraphs: pageParagraphs, width: viewport.width, height: viewport.height });
      const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
      if (operators.fnArray.some(x => imageOps.has(x))) limitations.push({ code: 'pdf-image-content', message: `第${number}页存在图像绘制内容；图内文字和公式尚未识别。`, affectsPresence: true, page: number });
      page.cleanup();
    }
    markRunningMargins(pages);
    return { name, format: 'pdf', sha256: await digest(buffer), bytes: buffer.byteLength, paragraphs, sections, objects: [], limitations: [...new Map(limitations.map(x => [`${x.code}:${x.page || 0}`, x])).values()], pageCount: pdf.numPages };
  } finally { await pdf.destroy(); }
}
