import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

// The original and the margin scroll independently. All geometry uses the same
// viewport coordinate system so an off-screen source never points to a new line.
export function useMarginLeader(layout: RefObject<HTMLElement | null>, selectionKey: string) {
  const path = useRef<SVGPathElement>(null);
  const anchor = useRef<number | null>(null);
  const schedule = useRef<(() => void) | null>(null);
  const onAnchorChange = useCallback((top: number | null) => {
    anchor.current = top;
    schedule.current?.();
  }, []);

  useLayoutEffect(() => {
    const root = layout.current;
    if (!root || !path.current) return;
    const line = path.current;
    const margin = root.querySelector<HTMLElement>('.margin-body');
    const track = margin?.querySelector<HTMLElement>('.margin-track');
    const note = track?.querySelector<HTMLElement>('.note-content');
    line.removeAttribute('d');
    if (!margin || !track || !note) return;
    const viewport = root.querySelector<HTMLElement>('.paper-scroll');
    let frame = 0;
    margin.scrollTop = 0;
    const measure = () => {
      frame = 0;
      const compact = window.matchMedia('(max-width: 820px)').matches;
      const selected = root.querySelector<HTMLElement>('.audit-active, .annotation.active');
      if (compact || !selected || anchor.current === null || !viewport) {
        track.style.setProperty('--note-offset', '0px');
        line.removeAttribute('d');
        return;
      }
      const bounds = root.getBoundingClientRect();
      const area = margin.getBoundingClientRect();
      const source = selected.getBoundingClientRect();
      const paper = viewport.getBoundingClientRect();
      const y = anchor.current;
      const inset = Math.min(23, note.offsetHeight / 2);
      const room = Math.max(0, margin.clientHeight - note.offsetHeight - 12);
      const offset = Math.max(0, Math.min(y - area.top - inset, room));
      track.style.setProperty('--note-offset', offset + 'px');
      const destination = note.getBoundingClientRect();
      const startX = Math.min(source.right, paper.right - 4) - bounds.left;
      const endX = destination.left - bounds.left;
      const startY = y - bounds.top;
      const endY = destination.top + inset - bounds.top;
      if (y < paper.top || y > paper.bottom || endX <= startX || destination.top + inset < area.top) {
        line.removeAttribute('d');
        return;
      }
      const span = endX - startX;
      const c1x = startX + span * 0.45;
      const c2x = endX - span * 0.45;
      line.setAttribute('d', `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`);
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(measure); };
    schedule.current = request;
    const observer = new ResizeObserver(request);
    for (const element of [root, margin, note]) observer.observe(element);
    viewport?.addEventListener('scroll', request, { passive: true });
    margin.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    request();
    return () => {
      cancelAnimationFrame(frame);
      schedule.current = null;
      observer.disconnect();
      viewport?.removeEventListener('scroll', request);
      margin.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      line.removeAttribute('d');
    };
  }, [layout, selectionKey]);

  return { path, onAnchorChange };
}
