import type { FormatSpan, Paragraph } from '../domain/types';

// Word's native run indices distinguish even identical words repeated in a paragraph.
// Apply them to the preview only if the full sequence of text agrees.
export function wordRunOffsets(paragraph: Paragraph, rendered: string): number[] | null {
  if (paragraph.runs.map(run => run.text).join('') !== rendered) return null;
  const offsets = [0];
  for (const run of paragraph.runs) offsets.push(offsets[offsets.length - 1] + run.text.length);
  return offsets;
}

export function spanOffsets(offsets: number[], span: FormatSpan): [number, number] | null {
  if (span.firstRun < 1 || span.lastRun < span.firstRun || span.lastRun >= offsets.length) return null;
  return [offsets[span.firstRun - 1], offsets[span.lastRun]];
}

export function renderedRange(element: HTMLElement, [start, end]: [number, number]): Range | null {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, 4 /* SHOW_TEXT */);
  const range = doc.createRange();
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = length + (node.nodeValue?.length ?? 0);
    if (length <= start && start < next) range.setStart(node, start - length);
    if (length < end && end <= next) {
      range.setEnd(node, end - length);
      return range;
    }
    length = next;
  }
  return null;
}

export function clickedTextOffset(element: HTMLElement, event: MouseEvent): number | null {
  const doc = element.ownerDocument;
  const caret = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  const fallback = caret ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode ?? fallback?.startContainer;
  const offset = caret?.offset ?? fallback?.startOffset;
  if (!node || node.nodeType !== Node.TEXT_NODE || !element.contains(node) || offset === undefined) return null;
  const prefix = doc.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}
