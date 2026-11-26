const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pictureAttribute = 'data-review-float';

export interface WordPreviewNode {
  type?: string;
  className?: string;
  children?: WordPreviewNode[];
  cssStyle?: Record<string, string>;
  src?: string;
}

type PageReference = 'page' | 'margin';
type Alignment = 'left' | 'center' | 'right';
type Position = { relativeX: PageReference; relativeY: PageReference; x: Alignment | number; y: number };
type Picture = {
  width: number | null;
  height: number | null;
  position?: Position;
  wrap: 'topBottom' | 'square';
  wrapText: string;
  distance: { top: number; right: number; bottom: number; left: number };
};

const emuToPx = (value: string | null | undefined) => value && /^-?\d+$/.test(value) ? Number(value) / 9525 : null;
const wpChild = (element: Element | undefined, name: string) =>
  element && Array.from(element.childNodes).find((node): node is Element =>
    node.nodeType === 1 && (node as Element).namespaceURI === WP && (node as Element).localName === name);
const pageReference = (value: string | null | undefined): value is PageReference => value === 'page' || value === 'margin';
const alignment = (value: string | undefined): value is Alignment => value === 'left' || value === 'center' || value === 'right';

function readAnchor(element: Element): Picture {
  const extent = wpChild(element, 'extent');
  const horizontal = wpChild(element, 'positionH');
  const vertical = wpChild(element, 'positionV');
  const square = wpChild(element, 'wrapSquare');
  const topBottom = wpChild(element, 'wrapTopAndBottom');
  const offsetX = emuToPx(wpChild(horizontal, 'posOffset')?.textContent);
  const alignX = wpChild(horizontal, 'align')?.textContent?.trim();
  const x = alignment(alignX) ? alignX : offsetX;
  const y = emuToPx(wpChild(vertical, 'posOffset')?.textContent);
  const relativeX = horizontal?.getAttribute('relativeFrom');
  const relativeY = vertical?.getAttribute('relativeFrom');
  const flag = (name: string) => /^(1|true|on)$/i.test(element.getAttribute(name) ?? '');
  return {
    width: emuToPx(extent?.getAttribute('cx')),
    height: emuToPx(extent?.getAttribute('cy')),
    position: (square || topBottom) && !flag('simplePos') && !flag('behindDoc')
      && pageReference(relativeX) && pageReference(relativeY) && x !== null && y !== null
      ? { relativeX, relativeY, x, y } : undefined,
    wrap: topBottom ? 'topBottom' : 'square',
    wrapText: square?.getAttribute('wrapText') || 'bothSides',
    distance: {
      top: emuToPx(element.getAttribute('distT')) ?? 0,
      right: emuToPx(element.getAttribute('distR')) ?? 0,
      bottom: emuToPx(element.getAttribute('distB')) ?? 0,
      left: emuToPx(element.getAttribute('distL')) ?? 0,
    },
  };
}

export function bindFloatingPictures(xml: Document | undefined, drawings: WordPreviewNode[]) {
  const pictures: Picture[] = [];
  if (!xml) return { pictures, unmatched: true };
  const byReference = new Map<string, Element[]>();
  const anchors = Array.from(xml.getElementsByTagNameNS(WP, '*')).filter(e => e.localName === 'anchor' || e.localName === 'inline');
  let unmatched = false;
  for (const source of anchors) {
    const images = source.getElementsByTagNameNS(A, 'blip');
    const reference = images.length === 1 ? images[0].getAttributeNS(R, 'embed') : '';
    if (reference) {
      const group = byReference.get(reference) ?? [];
      group.push(source);
      byReference.set(reference, group);
    } else if (source.localName === 'anchor') unmatched = true;
  }
  const renderedByReference = new Map<string, WordPreviewNode[]>();
  for (const drawing of drawings) {
    const image = drawing.children?.length === 1 ? drawing.children[0] : undefined;
    if (image?.type !== 'image' || !image.src) continue;
    const group = renderedByReference.get(image.src) ?? [];
    group.push(drawing);
    renderedByReference.set(image.src, group);
  }
  for (const [reference, source] of byReference) {
    if (!source.some(e => e.localName === 'anchor')) continue;
    const rendered = renderedByReference.get(reference);
    if (!rendered || rendered.length !== source.length || source.some(e => e.localName !== 'anchor')) {
      unmatched = true;
      continue;
    }
    for (const [index, drawing] of rendered.entries()) {
      const layout = readAnchor(source[index]);
      // A shared image relationship identifies the image bytes, so its anchors cannot be paired reliably.
      if (source.length > 1) layout.position = undefined;
      drawing.cssStyle = { ...drawing.cssStyle, ['$' + pictureAttribute]: String(pictures.length) };
      pictures.push(layout);
    }
  }
  return { pictures, unmatched };
}

function inlinePreview(drawing: HTMLElement, picture: Picture) {
  drawing.style.cssFloat = 'none';
  drawing.style.position = 'static';
  drawing.style.display = 'inline-block';
  drawing.style.left = '';
  drawing.style.top = '';
  drawing.style.width = picture.width && picture.width > 0 ? `${picture.width}px` : 'auto';
  drawing.style.height = 'auto';
  drawing.style.maxWidth = '100%';
  drawing.style.overflow = 'hidden';
  drawing.setAttribute('data-float-placement', 'inline');
  const image = drawing.querySelector('img');
  if (image) {
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
  }
}

function overlaps(a: DOMRect, b: DOMRect) {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
    && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
}

function coversContent(article: HTMLElement, drawing: HTMLElement, spacer: HTMLElement) {
  const graphic = drawing.getBoundingClientRect();
  for (const block of article.children) {
    if (block === spacer || !overlaps(graphic, block.getBoundingClientRect())) continue;
    if (block.tagName !== 'P') return true;
    const walker = article.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const range = article.ownerDocument.createRange();
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim()) continue;
      range.selectNodeContents(text);
      if ([...range.getClientRects()].some(box => overlaps(box, graphic))) return true;
    }
    for (const object of block.querySelectorAll('img, svg')) {
      if (!drawing.contains(object) && overlaps(object.getBoundingClientRect(), graphic)) return true;
    }
  }
  return false;
}

function placePicture(drawing: HTMLElement, picture: Picture) {
  const { position, width, height, distance } = picture;
  const section = drawing.closest<HTMLElement>('section.word-paper');
  const article = drawing.closest<HTMLElement>('article');
  if (!position || !width || !height || width < 0 || height < 0 || !section || !article
      || article.parentElement !== section || drawing.closest('p')?.parentElement !== article
      || section.querySelectorAll(`[${pictureAttribute}]`).length !== 1
      || (parseInt(getComputedStyle(article).columnCount) || 1) > 1
      || !CSS.supports('shape-outside', 'inset(0px)')) return false;
  const image = drawing.querySelector('img');
  if (!image || image.style.transform || image.style.clipPath) return false;
  const style = getComputedStyle(section);
  const paperWidth = parseFloat(style.width);
  const paperHeight = parseFloat(style.minHeight);
  const marginLeft = parseFloat(style.paddingLeft);
  const marginTop = parseFloat(style.paddingTop);
  const marginRight = parseFloat(style.paddingRight);
  const marginBottom = parseFloat(style.paddingBottom);
  if (![paperWidth, paperHeight, marginLeft, marginTop, marginRight, marginBottom].every(Number.isFinite)) return false;
  const contentRight = paperWidth - marginRight;
  const horizontalStart = position.relativeX === 'page' ? 0 : marginLeft;
  const horizontalEnd = position.relativeX === 'page' ? paperWidth : contentRight;
  const x = typeof position.x === 'number' ? horizontalStart + position.x
    : position.x === 'left' ? horizontalStart
      : position.x === 'right' ? horizontalEnd - width : (horizontalStart + horizontalEnd - width) / 2;
  const y = (position.relativeY === 'page' ? 0 : marginTop) + position.y;
  if (x < 0 || x + width > paperWidth + 1 || y < article.offsetTop
      || y + height + distance.bottom > paperHeight - marginBottom) return false;
  const rightRoom = contentRight - x - width;
  const leftRoom = x - marginLeft;
  const side = leftRoom >= rightRoom ? 'right' : 'left';
  if (picture.wrap === 'square' && (side === 'right'
    ? rightRoom > distance.right + 1 || !['bothSides', 'left'].includes(picture.wrapText)
    : leftRoom > distance.left + 1 || !['bothSides', 'right'].includes(picture.wrapText))) return false;
  const floatWidth = picture.wrap === 'topBottom' ? contentRight - marginLeft
    : side === 'right' ? contentRight - x + distance.left : x + width - marginLeft + distance.right;
  if (floatWidth <= 0 || floatWidth > contentRight - marginLeft + 1) return false;
  const spacer = article.ownerDocument.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  Object.assign(spacer.style, {
    cssFloat: side,
    width: `${floatWidth}px`,
    height: `${y - article.offsetTop + height + distance.bottom}px`,
    shapeOutside: `inset(${Math.max(0, y - article.offsetTop - distance.top)}px 0 0 0)`,
  });
  article.prepend(spacer);
  const inlineStyle = drawing.style.cssText;
  const inlineImageStyle = image.style.cssText;
  Object.assign(drawing.style, {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    maxWidth: 'none',
  });
  Object.assign(image.style, { width: '100%', height: '100%' });
  if (drawing.offsetParent !== section || section.offsetHeight > paperHeight + 2 || coversContent(article, drawing, spacer)) {
    drawing.style.cssText = inlineStyle;
    image.style.cssText = inlineImageStyle;
    spacer.remove();
    return false;
  }
  drawing.setAttribute('data-float-placement', 'anchored');
  return true;
}

/** Keep unsupported floating pictures visible in document flow, clear of the manuscript text. */
export function placeFloatingPictures(body: HTMLElement, pictures: Picture[]) {
  const positioned: { drawing: HTMLElement; picture: Picture }[] = [];
  for (const drawing of body.querySelectorAll<HTMLElement>(`[${pictureAttribute}]`)) {
    const picture = pictures[Number(drawing.getAttribute(pictureAttribute))];
    if (!picture) continue;
    inlinePreview(drawing, picture);
    positioned.push({ drawing, picture });
  }
  let needsNotice = false;
  for (const { drawing, picture } of positioned) {
    if (!placePicture(drawing, picture)) needsNotice = true;
  }
  return needsNotice;
}
