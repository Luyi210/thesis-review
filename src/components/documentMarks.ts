import type { Check, Location, Report, Status } from '../domain/types';

export interface MarkSelection { id: string; item: number }
export interface SourceMark extends MarkSelection {
  status: 'fail' | 'warning' | 'manual';
  title: string;
  location: Location;
}
const priority = { fail: 0, warning: 1, manual: 2 };
const actionable = (status: Status): status is SourceMark['status'] =>
  status === 'fail' || status === 'warning' || status === 'manual';

export function sourceMarks(checks: Check[]): SourceMark[] {
  const marks: SourceMark[] = [];
  for (const check of checks) {
    check.items.forEach((item, index) => {
      if (actionable(item.status)) marks.push({
        id: check.rule.id, item: index, status: item.status, title: check.rule.title, location: item.location,
      });
    });
  }
  return marks.sort((a, b) => priority[a.status] - priority[b.status]);
}

export function pdfBoundsKey(location?: Location | null) {
  const box = location?.bbox;
  if (!location?.page || !box || box.length !== 4 || !box.every(Number.isFinite) ||
      box[2] <= box[0] || box[3] <= box[1]) return null;
  return location.page + ':' + box.join(',');
}

export function groupPdfMarks(marks: SourceMark[], page: number) {
  const groups = new Map<string, SourceMark[]>();
  for (const mark of marks) {
    if (mark.location.page !== page) continue;
    const key = pdfBoundsKey(mark.location);
    if (key) {
      const group = groups.get(key);
      if (group) group.push(mark);
      else groups.set(key, [mark]);
    }
  }
  return groups;
}

export function preferredMark(group: SourceMark[], selected: MarkSelection | null) {
  return group.find(mark => mark.id === selected?.id && mark.item === selected.item) ?? group[0];
}

type Bounds = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>;

/** Attach the leader near the first visible line, even if the paragraph spans a screen. */
export function visibleAnchorTop(mark: Bounds, scrollport: Bounds, windowSize: { width: number; height: number }) {
  const top = Math.max(mark.top, scrollport.top, 0);
  const bottom = Math.min(mark.bottom, scrollport.bottom, windowSize.height);
  const left = Math.max(mark.left, scrollport.left, 0);
  const right = Math.min(mark.right, scrollport.right, windowSize.width);
  if (bottom <= top || right <= left) return null;
  return Math.round(top + Math.min(10, (bottom - top) / 2));
}

const compact = (text: string) => text.replace(/\s+/g, '');

/** Match a rendered paragraph only with independently verified text or a unique excerpt. */
export function indexWordLayout(body: HTMLElement, doc: Report['document']) {
  const paragraphs = new Map(doc.paragraphs.map(paragraph => [paragraph.index, paragraph]));
  const objects = new Map(doc.objects.filter(object => object.id).map(object => [object.id, object]));
  const tableCountsAgree = body.querySelectorAll('table').length === doc.objects.filter(o => o.kind === 'table').length;
  const nodes = [...body.querySelectorAll<HTMLElement>('p')].map(element => ({
    element, text: compact(element.textContent || ''),
  }));
  const indexed = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const sourceClass = [...node.element.classList].find(name => /^audit-source-\d+$/.test(name));
    if (!sourceClass) continue;
    const index = Number(sourceClass.slice('audit-source-'.length));
    const existing = indexed.get(index);
    if (existing) existing.push(node);
    else indexed.set(index, [node]);
  }
  const excerpts = new Map<string, HTMLElement[]>();
  return (location: Location): HTMLElement[] => {
    if (location.paragraph) {
      const source = paragraphs.get(location.paragraph);
      const exact = indexed.get(location.paragraph)?.filter(node =>
        node.text === compact(source?.previewText ?? source?.text ?? ''));
      const object = objects.get(location.objectId);
      if (exact?.length === 1 && source && (source.text || object)) {
        const element = exact[0].element;
        if (object?.kind === 'table' && !location.excerpt && object.location.paragraph === location.paragraph) {
          const table = element.closest('table');
          return table && tableCountsAgree ? [table] : [];
        }
        if (object?.kind === 'image' && !source.text && !element.querySelector('img,svg')) return [];
        return [element];
      }
    }
    const key = compact(location.excerpt || '');
    if (!key) return [];
    let matches = excerpts.get(key);
    if (!matches) {
      matches = nodes.filter(node => node.text === key || (key.length >= 40 && node.text.startsWith(key)))
        .map(node => node.element);
      excerpts.set(key, matches);
    }
    return matches;
  };
}
