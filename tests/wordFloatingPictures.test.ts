import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { bindFloatingPictures, type WordPreviewNode } from '../src/components/wordFloatingPictures';

const pictureXml = (children: string) => new DOMParser().parseFromString(`
  <root xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${children}</root>`,
  'text/xml');
const drawing = (src: string): WordPreviewNode => ({ type: 'drawing', children: [{ type: 'image', src }] });
const inline = (id: string) => `<wp:inline><a:blip r:embed="${id}"/></wp:inline>`;
const floating = (id: string, verticalReference = 'page') => `
  <wp:anchor simplePos="0" behindDoc="0" distL="114300">
    <wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>
    <wp:positionV relativeFrom="${verticalReference}"><wp:posOffset>2100000</wp:posOffset></wp:positionV>
    <wp:extent cx="3240000" cy="1008000"/>
    <wp:wrapSquare wrapText="bothSides"/>
    <a:blip r:embed="${id}"/>
  </wp:anchor>`;

describe('Word floating picture metadata', () => {
  it('keeps a single picture anchored at the declared page height and preserves inline pictures', () => {
    const normal = drawing('inline');
    const float = drawing('float');
    const { pictures, unmatched } = bindFloatingPictures(pictureXml(inline('inline') + floating('float')), [normal, float]);
    expect(unmatched).toBe(false);
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatchObject({
      wrap: 'square', distance: { left: 12 },
      position: { relativeX: 'margin', relativeY: 'page', x: 'right', y: 2100000 / 9525 },
    });
    expect(float.cssStyle?.['$data-review-float']).toBe('0');
    expect(normal.cssStyle).toBeUndefined();
  });

  it('keeps paragraph-relative anchors and repeated image references in the safe in-flow preview', () => {
    const a = drawing('repeat');
    const b = drawing('repeat');
    const c = drawing('paragraph');
    const source = floating('repeat') + floating('repeat') + floating('paragraph', 'paragraph');
    const { pictures, unmatched } = bindFloatingPictures(pictureXml(source), [a, b, c]);
    expect(unmatched).toBe(false);
    expect(pictures).toHaveLength(3);
    expect(pictures.every(picture => !picture.position)).toBe(true);
  });

  it('never binds a floating position to an ambiguous inline drawing', () => {
    const ambiguous = drawing('mixed');
    const { pictures, unmatched } = bindFloatingPictures(pictureXml(inline('mixed') + floating('mixed')), [ambiguous]);
    expect(unmatched).toBe(true);
    expect(pictures).toHaveLength(0);
    expect(ambiguous.cssStyle).toBeUndefined();
  });
});
