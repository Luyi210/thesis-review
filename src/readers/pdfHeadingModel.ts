import type { Paragraph } from '../domain/types';
import type { PageBoundary } from './pdfBodyZones';
import { pdfHeadingFeatures, possibleUnstyledHeading } from './pdfHeadingFeatures';
import model from './pdfHeadingModel.json';

function headingProbability(features: number[]) {
  let score = model.offset;
  for (const tree of model.trees) {
    let node = tree[0];
    while (node.length === 4) {
      const [feature, boundary, left, right] = node;
      node = tree[Math.fround(features[feature]) <= boundary ? left : right];
    }
    score += node[0];
  }
  return 1 / (1 + Math.exp(-score));
}

export function markPossiblePdfHeadings(page: PageBoundary) {
  const lines = page.paragraphs.filter((line): line is Paragraph & { bbox: number[] } =>
    !line.toc && !line.pdfRegion && !line.excluded && line.bbox?.length === 4);
  const candidates = lines.flatMap((line, i) =>
    !line.heading && line.runs.every(run => run.size !== null) && possibleUnstyledHeading(line.text) ? [i] : []);
  if (!candidates.length || lines.length < 5 || page.width <= 0 || page.height <= 0) return;

  const features = pdfHeadingFeatures(lines, page.width, page.height);
  for (const i of candidates) {
    if (headingProbability(features[i]) >= model.threshold) lines[i].pdfHeadingCandidate = true;
  }
}
