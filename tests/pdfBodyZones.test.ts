import { describe, expect, it } from 'vitest';
import { paragraph } from '../src/readers/shared';
import { markPageZones, markRunningMargins } from '../src/readers/pdfBodyZones';
import type { Box, PageMarks } from '../src/readers/pdfGraphics';

const empty = (): PageMarks => ({ horizontal: [], vertical: [], images: [] });
const row = (text: string, bbox: Box) => ({ ...paragraph(1, text), bbox });

describe('PDF body exclusions require layout evidence independent of the expected body size', () => {
  it('recognizes a running margin at a stable location on distinct pages', () => {
    const pages = [1, 2, 3, 4].map(n => ({
      width: 600, height: 840,
      paragraphs: [row('重复的栏目名称', [65, n === 4 ? 130 : 35, 200, n === 4 ? 142 : 47]),
        row('重复的正文', [65, 200, 280, 209])],
    }));
    markRunningMargins(pages);
    expect(pages.map(p => p.paragraphs[0].pdfRegion)).toEqual(['running', 'running', 'running', undefined]);
    expect(pages.every(p => !p.paragraphs[1].excluded)).toBe(true);
  });

  it('keeps small body text, including at the foot of a page, without a numbered note below a rule', () => {
    const body = row('一整行小字号的正文。', [58, 735, 443, 744]);
    const citation = row('[2] 引用的资料需要进一步核对。', [58, 757, 420, 766]);
    markPageZones([body, citation], empty(), 600, 840);
    expect(body.excluded || citation.excluded).toBe(false);
    markPageZones([body, citation], { ...empty(), horizontal: [[58, 718, 199, 718]] }, 600, 840);
    expect(body.excluded || citation.excluded).toBe(false);
  });

  it('recognizes a source footnote followed by a regularly spaced continuation and stops at a large gap', () => {
    const above = row('在注释前的正文。', [58, 681, 480, 693]);
    const note = row('[3] 引文资料。', [58, 730, 362, 739]);
    const continuation = row('续行。', [58, 747, 297, 756]);
    const separate = row('独立的小字行。', [58, 780, 355, 789]);
    markPageZones([above, note, continuation, separate], { ...empty(), horizontal: [[58, 720, 188, 720]] }, 600, 840);
    expect([above, note, continuation, separate].map(p => p.pdfRegion)).toEqual([undefined, 'footnote', 'footnote', undefined]);
  });

  it('separates an illustrated caption and complete note from a body reference and parenthetical body text', () => {
    const reference = row('图2呈现课堂活动，说明各个步骤。', [65, 120, 505, 132]);
    const caption = row('图2 活动步骤', [250, 251, 350, 262]);
    const note = row('（图中箭头表示', [80, 266, 430, 274]);
    const continuation = row('活动顺序。）', [80, 276, 280, 284]);
    const body = row('新一段正文。', [70, 295, 190, 307]);
    const marks: PageMarks = { ...empty(), images: [[110, 140, 490, 248]] };
    markPageZones([reference, caption, note, continuation, body], marks, 600, 840);
    expect([reference, caption, note, continuation, body].map(p => p.pdfRegion)).toEqual(
      [undefined, 'caption', 'caption', 'caption', undefined]);
    const ordinary = row('（这段正文展示另一种方法。）', [75, 265, 325, 277]);
    markPageZones([caption, ordinary], marks, 600, 840);
    expect(ordinary.caption).toBe(false);
    const unclosed = row('（图中箭头为', [75, 265, 330, 274]);
    markPageZones([caption, unclosed, body], marks, 600, 840);
    expect(unclosed.caption || body.caption).toBe(false);
  });

  it('uses the coordinates of a closed ruled table and preserves text next to and below it', () => {
    const markers: PageMarks = {
      horizontal: [[58, 110, 510, 110], [58, 137, 510, 137], [58, 176, 510, 176]],
      vertical: [[58, 110, 58, 176], [220, 110, 220, 176], [510, 110, 510, 176]], images: [],
    };
    const title = row('表1 试验条件', [240, 93, 340, 104]);
    const head = row('组别  温度', [71, 119, 339, 129]);
    const cell = row('冷却后的试样', [70, 149, 172, 160]);
    const side = row('栏外说明', [530, 154, 580, 165]);
    const tail = row('表1显示了结果。', [65, 181, 385, 190]);
    markPageZones([title, head, cell, side, tail], markers, 600, 840);
    expect([title, head, cell, side, tail].map(p => p.pdfRegion)).toEqual(['caption', 'table', 'table', undefined, undefined]);
    const noGrid = row('完整段落', [70, 149, 300, 159]);
    markPageZones([row(title.text, [240, 93, 340, 104]), noGrid], { ...markers, vertical: [] }, 600, 840);
    expect(noGrid.inTable).toBe(false);
  });

  it('keeps unsupported figure-like prose available and recognizes a centered chapter-number caption', () => {
    const comment = row('图1 讨论方法', [60, 110, 155, 119]);
    const reference = row('图2-3显示各项结果。', [240, 140, 360, 151]);
    const caption = row('图2-3 试样的安装方式', [240, 180, 360, 191]);
    markPageZones([comment, reference, caption], empty(), 600, 840);
    expect([comment, reference, caption].map(p => p.pdfRegion)).toEqual([undefined, undefined, 'caption']);
  });
});
