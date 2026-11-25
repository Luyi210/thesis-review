import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, LoaderCircle, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { Location, Report } from '../domain/types';
import { wordRunOffsets, spanOffsets, renderedRange, clickedTextOffset } from './wordRanges';
import { openPdf } from '../readers/pdf';
import { groupPdfMarks, indexWordLayout, pdfBoundsKey, preferredMark, sourceMarks, visibleAnchorTop, type MarkSelection, type SourceMark } from './documentMarks';

interface Props {
  buffer: ArrayBuffer;
  report: Report;
  selected: MarkSelection | null;
  focusLocation?: Location | null;
  onSelect: (id: string, item: number) => void;
  onAnchorChange?: (top: number | null) => void;
}

export function DocumentViewer({ buffer, report, selected, focusLocation, onSelect, onAnchorChange }: Props) {
  const isPdf = report.document.format === 'pdf';
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState({ width: 595, height: 842 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<{ body: HTMLElement; buffer: ArrayBuffer } | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const officeHost = useRef<HTMLDivElement>(null);
  const paperScroll = useRef<HTMLDivElement>(null);
  const pdfActive = useRef<HTMLElement | null>(null);
  const revealed = useRef<{ target: HTMLElement; selection: MarkSelection | null; focus?: Location | null } | null>(null);
  const fitAutomatically = useRef(true);
  const naturalWidth = useRef(0);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onAnchorRef = useRef(onAnchorChange);
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  onAnchorRef.current = onAnchorChange;

  const selectedItem = selected && report.checks.find(c => c.rule.id === selected.id)?.items[selected.item];
  const selectedLocation = focusLocation ?? selectedItem?.location;
  const byParagraph = useMemo(() => new Map(report.document.paragraphs.map(p => [p.index, p])), [report.document]);
  const marks = useMemo(() => sourceMarks(report.checks), [report.checks]);
  const pdfGroups = useMemo(() => isPdf ? groupPdfMarks(marks, page) : new Map<string, SourceMark[]>(), [isPdf, marks, page]);
  const selectedBox = selectedLocation?.page === page ? pdfBoundsKey(selectedLocation) : null;
  const locate = useMemo(() => layout?.buffer === buffer ? indexWordLayout(layout.body, report.document) : null, [layout, buffer, report.document]);
  const wordMatches = useMemo(() => locate && selectedLocation ? locate(selectedLocation) : [], [locate, selectedLocation]);
  const wordActive = wordMatches.length === 1 ? wordMatches[0] : null;
  const unmappedWord = locate && (selectedLocation?.paragraph || selectedLocation?.excerpt || selectedLocation?.objectId) && !wordActive;
  const mapping = unmappedWord ? (wordMatches.length > 1 ? '同一片段出现多次，请根据批注中的源段号核对。' : '预览中未能定位此处，请根据源段号或摘录核对。') : '';

  function fitWidth() {
    const scroll = paperScroll.current;
    if (!scroll || !naturalWidth.current) return;
    const css = getComputedStyle(scroll);
    const available = scroll.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    if (available > 0) setZoom(Math.max(.4, Math.min(1.5, Math.floor(available / naturalWidth.current * 100) / 100)));
  }

  useEffect(() => {
    let dead = false;
    let ownedPdf: PDFDocumentProxy | null = null;
    setError(''); setLoading(true); setPdf(null); setLayout(null); setPage(1);
    fitAutomatically.current = true;
    naturalWidth.current = 0;
    if (isPdf) {
      void openPdf(buffer).then(doc => {
        if (dead) void doc.destroy();
        else { ownedPdf = doc; setPdf(doc); }
      }).catch(e => {
        if (!dead) { setError(String(e.message || e)); setLoading(false); }
      });
    } else {
      const host = officeHost.current;
      if (!host) return;
      const styles = document.createElement('div');
      const body = document.createElement('div');
      host.replaceChildren(styles, body);
      void import('docx-preview').then(async lib => {
        const options = { className: 'word-paper', inWrapper: true, renderAltChunks: false, renderChanges: false, renderComments: false, useBase64URL: true, ignoreLastRenderedPageBreak: true };
        const parsed = await lib.parseAsync(buffer.slice(0), options);
        if (dead) return;
        interface PreviewNode { type?: string; className?: string; children?: PreviewNode[] }
        const sourceNodes: PreviewNode[] = [];
        const walk = (node: PreviewNode) => { if (node.type === 'paragraph') sourceNodes.push(node); node.children?.forEach(walk); };
        walk(parsed.documentPart.body as PreviewNode);
        // Both readers must agree on paragraph count before using their source indices.
        if (sourceNodes.length === report.document.paragraphs.length) sourceNodes.forEach((p, i) => {
          p.className = ((p.className || '') + ' audit-source-' + (i + 1)).trim();
        });
        await lib.renderDocument(parsed, body, styles, options);
        if (dead) return;
        body.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.removeAttribute('onclick'); });
        body.querySelectorAll('script,iframe,object,embed').forEach(x => x.remove());
        naturalWidth.current = body.querySelector<HTMLElement>('section')?.offsetWidth || 794;
        fitWidth();
        setLayout({ body, buffer }); setLoading(false);
      }).catch(e => {
        if (!dead) { setError('Word 布局预览失败：' + (e.message || e)); setLoading(false); }
      });
    }
    return () => { dead = true; if (ownedPdf) void ownedPdf.destroy(); };
  }, [buffer, isPdf, report.document]);

  useEffect(() => {
    if (isPdf && selectedLocation?.page) setPage(selectedLocation.page);
  }, [isPdf, selectedLocation, selected]);

  useEffect(() => {
    const scroll = paperScroll.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => { if (fitAutomatically.current) fitWidth(); });
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvasHost.current) return;
    let dead = false;
    let task: RenderTask | null = null;
    setLoading(true);
    const canvas = document.createElement('canvas');
    canvasHost.current.replaceChildren(canvas);
    void pdf.getPage(page).then(async p => {
      if (dead) return;
      naturalWidth.current = p.getViewport({ scale: 1 }).width;
      if (fitAutomatically.current) fitWidth();
      const viewport = p.getViewport({ scale: zoom });
      const pixel = Math.min(window.devicePixelRatio || 1, 2);
      setSize({ width: viewport.width, height: viewport.height });
      canvas.width = Math.floor(viewport.width * pixel); canvas.height = Math.floor(viewport.height * pixel);
      canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
      task = p.render({ canvas, viewport, transform: pixel !== 1 ? [pixel, 0, 0, pixel, 0, 0] : undefined });
      await task.promise;
      if (!dead) setLoading(false);
    }).catch(e => {
      if (!dead && e.name !== 'RenderingCancelledException') { setError(e.message); setLoading(false); }
    });
    return () => { dead = true; task?.cancel(); };
  }, [pdf, page, zoom]);

  useLayoutEffect(() => {
    if (!locate) return;
    const grouped = new Map<HTMLElement, SourceMark[]>();
    for (const mark of marks) {
      const matches = locate(mark.location);
      if (matches.length !== 1) continue;
      const group = grouped.get(matches[0]);
      if (group) group.push(mark);
      else grouped.set(matches[0], [mark]);
    }
    const controls = new AbortController();
    grouped.forEach((group, element) => {
      element.classList.add('audit-mark');
      if (group[0].status !== 'fail') element.classList.add('audit-' + group[0].status);
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      const title = [...new Set(group.map(mark => mark.title))].join('、');
      element.title = title;
      const excerpt = (element.textContent || '').trim().slice(0, 40);
      element.setAttribute('aria-label', '查看批注：' + title + (excerpt ? '。' + excerpt : ''));
      const choose = (event: Event) => {
        event.stopPropagation();
        let mark = preferredMark(group, selectedRef.current);
        if (event instanceof MouseEvent && event.detail > 0 && group.some(m => m.formatSpan)) {
          const paragraph = byParagraph.get(mark.location.paragraph ?? -1);
          const offsets = paragraph && wordRunOffsets(paragraph, element.textContent || '');
          const at = offsets ? clickedTextOffset(element, event) : null;
          if (offsets && at !== null) {
            const hits = group.filter(m => {
              const range = m.formatSpan && spanOffsets(offsets, m.formatSpan);
              return range && at >= range[0] && at < range[1];
            });
            if (hits.length) mark = preferredMark(hits, selectedRef.current);
          }
        }
        onSelectRef.current(mark.id, mark.item);
      };
      element.addEventListener('click', choose, { signal: controls.signal });
      element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        choose(event);
      }, { signal: controls.signal });
    });
    return () => {
      controls.abort();
      grouped.forEach((_, element) => {
        element.classList.remove('audit-mark', 'audit-warning', 'audit-manual');
        for (const attr of ['tabindex', 'role', 'title', 'aria-label']) element.removeAttribute(attr);
      });
    };
  }, [locate, marks, byParagraph]);

  useLayoutEffect(() => {
    if (!wordActive) return;
    wordActive.classList.add('audit-active');
    wordActive.setAttribute('aria-current', 'true');
    return () => { wordActive.classList.remove('audit-active'); wordActive.removeAttribute('aria-current'); };
  }, [wordActive]);

  useLayoutEffect(() => {
    const span = selectedItem?.formatSpan;
    const paragraph = byParagraph.get(selectedItem?.location.paragraph ?? -1);
    if (!wordActive || !span || !paragraph || focusLocation || !globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
    const offsets = wordRunOffsets(paragraph, wordActive.textContent || '');
    const bounds = offsets && spanOffsets(offsets, span);
    const range = bounds && renderedRange(wordActive, bounds);
    if (!range) return;
    CSS.highlights.set('review-text', new Highlight(range));
    return () => { CSS.highlights.delete('review-text'); };
  }, [selectedItem, wordActive, byParagraph, focusLocation]);

  // Jump to an expressly selected, offscreen occurrence in the scrollport only.
  // A paragraph clicked in the manuscript is already visible and stays where it was.
  useLayoutEffect(() => {
    const scroll = paperScroll.current;
    const target = isPdf ? pdfActive.current : wordActive;
    if (!target || !scroll || loading || error) return;
    const previous = revealed.current;
    if (previous?.target === target && previous.selection === selected && previous.focus === focusLocation) return;
    revealed.current = { target, selection: selected, focus: focusLocation };
    const rect = target.getBoundingClientRect(), frame = scroll.getBoundingClientRect();
    if (rect.bottom <= frame.top || rect.top >= frame.bottom) {
      scroll.scrollTop += rect.top - frame.top - Math.max(16, (frame.height - rect.height) / 2);
    }
    if (rect.right <= frame.left || rect.left >= frame.right) {
      scroll.scrollLeft += rect.left - frame.left - 16;
    }
  }, [selected, focusLocation, wordActive, isPdf, selectedBox, error, loading]);

  useLayoutEffect(() => {
    const scroll = paperScroll.current;
    const target = isPdf ? pdfActive.current : wordActive;
    if (!target || !scroll || loading || error) {
      onAnchorRef.current?.(null);
      return;
    }
    let frame = 0;
    let previous: number | null | undefined;
    const measure = () => {
      frame = 0;
      const top = visibleAnchorTop(target.getBoundingClientRect(), scroll.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
      if (top !== previous) { previous = top; onAnchorRef.current?.(top); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(target);
    if (layout) observer.observe(layout.body);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
      onAnchorRef.current?.(null);
    };
  }, [isPdf, wordActive, selectedBox, layout, page, zoom, size, loading, error]);

  function changeZoom(step: number) {
    fitAutomatically.current = false;
    setZoom(z => Math.max(.4, Math.min(1.5, Math.round((z + step) * 10) / 10)));
  }
  const previewHint = isPdf ? '页码按文件实际顺序计算，含封面。' : '预览字体和分页可能与 Word/WPS 有差异。位置使用源段号。';
  return <div className="viewer-shell">
    <div className="viewer-toolbar">
      <div title={previewHint}><FileText size={15}/><span>{isPdf ? 'PDF 原页' : 'Word 预览'}</span></div>
      <div className="viewer-controls">{isPdf && <>
        <button aria-label="上一页" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/></button>
        <span>{page} / {report.document.pageCount}</span>
        <button aria-label="下一页" disabled={page >= (report.document.pageCount || 1)} onClick={() => setPage(p => p + 1)}><ChevronRight size={16}/></button><i/>
      </>}
        <button aria-label="缩小" disabled={zoom <= .4} onClick={() => changeZoom(-.1)}><Minus size={15}/></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label="放大" disabled={zoom >= 1.5} onClick={() => changeZoom(.1)}><Plus size={15}/></button>
        <button className="fit-width" onClick={() => { fitAutomatically.current = true; fitWidth(); }}>适应宽度</button>
      </div>
    </div>
    {mapping && <div className="mapping-note" role="status">{mapping}</div>}
    <div className="paper-scroll" ref={paperScroll}>
      {loading && <div className="render-loading"><LoaderCircle className="spin" size={20}/>正在准备原文预览…</div>}
      {error && <div role="alert" className="error-box">{error}</div>}
      {isPdf ? <div className="pdf-paper" style={{ width: size.width, height: size.height }}>
        <div ref={canvasHost}/>
        <div className="annotation-layer">{[...pdfGroups].map(([key, group]) => {
          const mark = preferredMark(group, selected);
          const [left, top, right, bottom] = mark.location.bbox!;
          const title = [...new Set(group.map(x => x.title))].join('、');
          const active = selectedBox === key;
          return <button key={key} ref={active ? el => { pdfActive.current = el; } : undefined}
            aria-label={'查看批注：' + title + '，第' + page + '页'} title={title} aria-pressed={active}
            className={'annotation ' + group[0].status + (active ? ' active' : '')}
            style={{ left: left * zoom, top: top * zoom, width: Math.max(8, (right - left) * zoom), height: Math.max(12, (bottom - top) * zoom) }}
            onClick={() => onSelect(mark.id, mark.item)} />;
        })}
        {selectedBox && !pdfGroups.has(selectedBox) && selectedLocation?.bbox && <span className="annotation active"
          ref={el => { pdfActive.current = el; }} aria-hidden="true" style={{ pointerEvents: 'none',
            left: selectedLocation.bbox[0] * zoom, top: selectedLocation.bbox[1] * zoom,
            width: (selectedLocation.bbox[2] - selectedLocation.bbox[0]) * zoom, height: (selectedLocation.bbox[3] - selectedLocation.bbox[1]) * zoom,
          }}/>}
        </div>
      </div> : <div className="office-host" ref={officeHost} style={{ zoom }}/>}
    </div>
  </div>;
}
