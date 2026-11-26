import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pdfHeadingFeatures, possibleUnstyledHeading } from '../src/readers/pdfHeadingFeatures.ts';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/prepare-pdf-heading-training.mjs pages.jsonl > lines.csv');

const heading = new Set(['title', 'section-header']);
const otherRoles = new Set(['text', 'list-item', 'caption', 'footnote', 'formula', 'page-header', 'page-footer', 'table']);
const seen = new Set();
const groups = new Map();

// The corpus supplies individual text cells and region labels. Reconstruct
// horizontal lines, keeping wide intra-row gaps separate as in a multi-column page.
function mergeCells(cells, pageWidth) {
  const ordered = cells.filter(({ bbox, text }) => text?.trim() && bbox[2] > bbox[0] && bbox[3] > bbox[1])
    .sort((a, b) => a.bbox[1] - b.bbox[1]);
  const rows = [];
  for (const cell of ordered) {
    const [left, top, right, bottom] = cell.bbox;
    const row = rows.at(-1);
    if (row && Math.min(row[3], bottom) - Math.max(row[1], top) >= 0.55 * Math.min(row[3] - row[1], bottom - top)) {
      row[4].push(cell);
    } else {
      rows.push([left, top, right, bottom, [cell]]);
    }
  }
  const lines = [];
  for (const row of rows) {
    const cellsOnRow = row[4].sort((a, b) => a.bbox[0] - b.bbox[0]);
    let line;
    for (const cell of cellsOnRow) {
      const [left, top, right, bottom] = cell.bbox;
      if (line && left - line.bbox[2] <= pageWidth * .045) {
        const [x1, y1, x2, y2] = line.bbox;
        line.bbox = [x1, Math.min(y1, top), Math.max(x2, right), Math.max(y2, bottom)];
        line.text += ' ' + cell.text;
      } else {
        line = { text: cell.text, bbox: [...cell.bbox] };
        lines.push(line);
      }
    }
  }
  return lines;
}

function trainingLabel(line, annotations) {
  const [x1, y1, x2, y2] = line.bbox;
  const area = (x2 - x1) * (y2 - y1);
  const matched = new Set();
  for (const annotation of annotations) {
    const [left, top, right, bottom] = annotation.bbox;
    const overlap = Math.max(0, Math.min(x2, right) - Math.max(x1, left))
      * Math.max(0, Math.min(y2, bottom) - Math.max(y1, top));
    if (overlap / area < .75) continue;
    const role = annotation.role.toLowerCase();
    matched.add(heading.has(role) ? 1 : otherRoles.has(role) ? 0 : -1);
  }
  return matched.size === 1 ? [...matched][0] : -1;
}

const source = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
const splitCode = new Map([['train', 0], ['val', 1], ['validation', 1], ['test', 2]]);
for await (const raw of source) {
  const page = JSON.parse(raw);
  const code = splitCode.get(page.split);
  if (code === undefined || !page.doc || !(page.width > 0) || !(page.height > 0)) continue;
  // Keep source-document versions on one side of the boundary.
  if (groups.has(page.doc) && groups.get(page.doc) !== code) throw new Error('Source document appears in more than one split');
  const key = JSON.stringify([page.doc, page.page]);
  if (seen.has(key)) continue;
  seen.add(key);
  groups.set(page.doc, code);
  const lines = mergeCells(page.cells, page.width);
  const features = pdfHeadingFeatures(lines, page.width, page.height);
  const rows = lines.map((line, i) => {
    const label = trainingLabel(line, page.annotations);
    return label >= 0 ? [code, label, Number(possibleUnstyledHeading(line.text)), ...features[i]].join(',') + '\n' : '';
  }).join('');
  if (rows && !process.stdout.write(rows)) await once(process.stdout, 'drain');
}
console.error(`Prepared ${seen.size} unique pages from ${groups.size} source documents`);
