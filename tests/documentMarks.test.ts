import { describe, expect, it } from 'vitest';
import { groupPdfMarks, indexWordLayout, pdfBoundsKey, preferredMark, sourceMarks, visibleAnchorTop } from '../src/components/documentMarks';
import { paragraph } from '../src/readers/shared';
import type { AuditDocument, Check, Status } from '../src/domain/types';

const location = { page: 2, bbox: [10, 20, 130, 35] };
const check = (id: string, statuses: Status[]): Check => ({
  rule: { id, title: id }, items: statuses.map(status => ({ status, location, observed: id })),
} as Check);

describe('source-side margin marks', () => {
  it('offers one target for co-located checks and retains a chosen occurrence within the group', () => {
    const marks = sourceMarks([check('字体', ['manual', 'pass']), check('字号', ['warning', 'fail'])]);
    const groups = groupPdfMarks(marks, 2);
    expect([...groups.keys()]).toEqual([pdfBoundsKey(location)]);
    const group = [...groups.values()][0];
    expect(group.map(mark => mark.status)).toEqual(['fail', 'warning', 'manual']);
    expect(preferredMark(group, null)).toMatchObject({ id: '字号', item: 1 });
    expect(preferredMark(group, { id: '字号', item: 0 }).status).toBe('warning');
    expect(groupPdfMarks(marks, 3).size).toBe(0);
  });
  it('leaves page-only findings and malformed boxes without a text anchor', () => {
    expect(pdfBoundsKey({ page: 2 })).toBeNull();
    expect(pdfBoundsKey({ page: 2, bbox: [0, 0, Infinity, 32] })).toBeNull();
    expect(pdfBoundsKey({ page: 2, bbox: [50, 10, 40, 20] })).toBeNull();
  });
  it('measures the visible part of the selected line, taking document scroll and the browser viewport into account', () => {
    const frame = { left: 20, right: 400, top: 40, bottom: 320 };
    const viewport = { width: 350, height: 240 };
    expect(visibleAnchorTop({ left: 30, right: 140, top: 10, bottom: 48 }, frame, viewport)).toBe(44);
    expect(visibleAnchorTop({ left: 30, right: 140, top: 230, bottom: 600 }, frame, viewport)).toBe(235);
    expect(visibleAnchorTop({ left: 355, right: 380, top: 50, bottom: 70 }, frame, viewport)).toBeNull();
    expect(visibleAnchorTop({ left: 30, right: 140, top: 20, bottom: 39 }, frame, viewport)).toBeNull();
  });
  it('uses verified Word paragraph identity and refuses duplicated fallback excerpts', () => {
    const node = (index: number, textContent: string) => ({ classList: ['audit-source-' + index], textContent });
    const first = node(1, '重复段落'), second = node(2, '重复段落'), third = node(3, '唯一片段');
    const body = { querySelectorAll: (selector: string) => selector === 'p' ? [first, second, third] : [] };
    const doc: AuditDocument = {
      name: 'test.docx', format: 'docx', sha256: '', bytes: 0, sections: [], limitations: [], objects: [],
      paragraphs: [first, second, third].map((p, i) => paragraph(i + 1, p.textContent)),
    };
    const locate = indexWordLayout(body as unknown as HTMLElement, doc);
    expect(locate({ paragraph: 2, excerpt: '重复段落' })).toEqual([second]);
    expect(locate({ excerpt: '重复段落' })).toHaveLength(2);
    expect(locate({ paragraph: 6, excerpt: '唯一片段' })).toEqual([third]);
    expect(locate({ section: 1 })).toEqual([]);
  });
  it('locates a sole floating picture on the drawing while preserving the text anchor in that paragraph', () => {
    const drawing = {};
    const source = { classList: ['audit-source-1'], textContent: '合成正文',
      querySelectorAll: (selector: string) => selector === '[data-float-placement]' ? [drawing] : [] };
    const body = { querySelectorAll: (selector: string) => selector === 'p' ? [source] : [] } as unknown as HTMLElement;
    const location = { paragraph: 1, objectId: 'image-1' };
    const picture = { kind: 'image' as const, id: 'image-1', inline: false, location, detail: '' };
    const doc: AuditDocument = {
      name: 'test.docx', format: 'docx', sha256: '', bytes: 0, sections: [], limitations: [], objects: [picture],
      paragraphs: [paragraph(1, source.textContent)],
    };
    expect(indexWordLayout(body, doc)(location)).toEqual([drawing]);
    expect(indexWordLayout(body, doc)({ paragraph: 1 })).toEqual([source]);
    const ambiguousDoc = { ...doc, objects: [picture, { ...picture, inline: true, id: 'image-2' }] };
    expect(indexWordLayout(body, ambiguousDoc)(location)).toEqual([source]);
  });
});
