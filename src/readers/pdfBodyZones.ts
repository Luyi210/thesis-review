import type { Paragraph } from '../domain/types';
import type { Box, PageMarks } from './pdfGraphics';

type Line = Paragraph & { bbox: number[] };
function hasBox(p: Paragraph): p is Line { return p.bbox?.length === 4; }
function near(a: number, b: number, tolerance = 3) { return Math.abs(a - b) <= tolerance; }
function withinX(box: number[], outer: number[]) {
  return box[0] >= outer[0] - 3 && box[2] <= outer[2] + 3;
}
function height(line: Line) { return line.bbox[3] - line.bbox[1]; }
function isClose(previous: Line, line: Line) {
  const gap = line.bbox[1] - previous.bbox[3];
  return gap >= -2 && gap <= Math.max(5, height(previous) * 0.65);
}

// Match a bounded grid beneath a table caption. A line crossing its side or
// missing the bottom border stays available to the normal body check.
function tableGrid(caption: Line, marks: PageMarks): Box | undefined {
  const top = marks.horizontal.filter(b => withinX(caption.bbox, b) && b[2] - b[0] >= 60
    && b[1] >= caption.bbox[3] - 2 && b[1] <= caption.bbox[3] + 20)
    .sort((a, b) => a[1] - b[1])[0];
  if (!top) return;
  const edges = marks.vertical.filter(b => near(b[1], top[1]) && b[0] >= top[0] - 3 && b[0] <= top[2] + 3);
  const left = edges.find(b => near(b[0], top[0]));
  if (!left || !edges.some(b => near(b[0], top[2]) && near(b[3], left[3]))) return;
  const bars = marks.horizontal.filter(b => near(b[0], top[0]) && near(b[2], top[2]));
  if (!bars.some(b => near(b[1], left[3])) || !bars.some(b => b[1] > top[1] + 4 && b[1] < left[3] - 4)) return;
  return [top[0], top[1], top[2], left[3]];
}

function markCaptionNotes(lines: Line[], first: number) {
  const note = lines[first];
  if (!note || !isClose(lines[first - 1], note)
    || !/^[（(]\s*(?:图中|图示|图内|按.{1,20}(?:顺序|排列)|资料来源|数据来源|(?:注|说明)[：:])/.test(note.text)) return;
  // Only exclude complete parenthetical notes. An unclosed bracket must not
  // absorb unrelated following paragraphs.
  let depth = 0;
  for (let i = first; i < Math.min(first + 6, lines.length); i++) {
    const line = lines[i];
    if (line.heading || (i > first && (!isClose(lines[i - 1], line) || !near(height(note), height(line), 1)))) return;
    for (const char of line.text) {
      if (char === '（' || char === '(') depth++;
      if (char === '）' || char === ')') depth--;
      if (depth < 0) return;
    }
    if (!depth) {
      if (!/[）)]\s*[。.]?$/.test(line.text)) return;
      for (const p of lines.slice(first, i + 1)) { p.caption = true; p.pdfRegion = 'caption'; }
      return;
    }
  }
}

function markFootnotes(lines: Line[], marks: PageMarks, pageWidth: number, pageHeight: number) {
  const separator = marks.horizontal.filter(b => b[1] > pageHeight * .5
    && b[2] - b[0] >= 36 && b[2] - b[0] <= pageWidth * .48);
  for (const bar of separator) {
    const start = lines.findIndex(p => p.bbox[1] >= bar[3] - 1);
    if (start < 0) continue;
    const first = lines[start];
    if (first.bbox[1] - bar[3] > 18 || !near(first.bbox[0], bar[0], 5)
      || !/^[\[［]\s*\d{1,4}(?:\s*[\]］]|\s+\p{L})/u.test(first.text)) continue;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      const gap = i > start ? line.bbox[1] - lines[i - 1].bbox[3] : 0;
      if (line.excluded || line.heading || !near(line.bbox[0], first.bbox[0], 10)
        || !near(height(first), height(line), 1.8) || gap < -2 || gap > height(first)) break;
      line.excluded = true;
      line.pdfRegion = 'footnote';
    }
  }
}

export function markPageZones(paragraphs: Paragraph[], marks: PageMarks, pageWidth: number, pageHeight: number) {
  const lines = paragraphs.filter(hasBox);
  markFootnotes(lines, marks, pageWidth, pageHeight);
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i];
    // Ordinary sentences can start with "图2给出…" or "表1中可见…".
    const title = /^(图|表)\s*\d+(?:\s*[-－—.．]\s*\d+)*\s*(.*)$/u.exec(p.text);
    if (!title || p.excluded || p.toc || !title[2] || title[2].length > 85 || /[。！？；]/.test(title[2])
      || /^(?:所示|表明|显示|展示|给出|列出|呈现|可见|说明了|中[的可列显给])/.test(title[2])) continue;
    const grid = title[1] === '表' ? tableGrid(p, marks) : undefined;
    const underImage = title[1] === '图' && marks.images.some(b => p.bbox[1] >= b[3] - 3 && p.bbox[1] <= b[3] + 24
      && (p.bbox[0] + p.bbox[2]) / 2 >= b[0] && (p.bbox[0] + p.bbox[2]) / 2 <= b[2]);
    // Retain conventionally numbered captions in text-only, single-column
    // previews when their position also supports a caption reading.
    const centeredChapterCaption = /^[图表]\s*\d+\s*[-－—.．]\s*\d+/.test(p.text)
      && near((p.bbox[0] + p.bbox[2]) / 2, pageWidth / 2, pageWidth * .035);
    if (!grid && !underImage && !centeredChapterCaption) continue;
    p.caption = true;
    p.pdfRegion = 'caption';
    if (grid) {
      for (const row of lines.slice(i + 1)) {
        if (row.bbox[1] > grid[3]) break;
        if (withinX(row.bbox, grid) && row.bbox[1] >= grid[1] - 1 && row.bbox[3] <= grid[3] + 1) {
          row.inTable = true;
          row.pdfRegion = 'table';
        }
      }
    } else if (underImage) markCaptionNotes(lines, i + 1);
  }
}

export interface PageBoundary { paragraphs: Paragraph[]; width: number; height: number }
export function markRunningMargins(pages: PageBoundary[]) {
  const groups = new Map<string, { line: Line; x: number; y: number }[]>();
  for (const { paragraphs, width, height: h } of pages) {
    const first = paragraphs[0], last = paragraphs[paragraphs.length - 1];
    for (const line of new Set([first, last])) {
      if (!line || !hasBox(line)) continue;
      const top = line === first && line.bbox[3] <= h * .085;
      const bottom = line === last && line.bbox[1] >= h * .915;
      if (!top && !bottom) continue;
      const title = line.text.replace(/\s+/gu, '').replace(/第\d+页/gu, '第#页');
      const key = (top ? 'top:' : 'bottom:') + title;
      const group = groups.get(key) ?? [];
      group.push({ line, x: line.bbox[0] / width, y: line.bbox[1] / h });
      groups.set(key, group);
    }
  }
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    for (const entry of group) {
      const matches = group.filter(p => near(p.x, entry.x, .015) && near(p.y, entry.y, .006));
      if (matches.length < 3) continue;
      entry.line.excluded = true;
      entry.line.pdfRegion = 'running';
    }
  }
}
