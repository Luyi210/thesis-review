interface TextLine {
  text: string;
  bbox: readonly number[];
}

const numberedPrefix = /^(?:第[〇零一二三四五六七八九十百\d]+[章节]|[（(][〇零一二三四五六七八九十百\d]+[）)]|[〇零一二三四五六七八九十百]+[、.．]|\d{1,2}(?:[.．]\d{1,2}){1,3}(?=\s|\p{Script=Han})|\d{1,2}[.．、)](?=\s*\S))/u;
const sentenceEnd = /[。！？!?；;，,.:：]$/;

export function possibleUnstyledHeading(text: string) {
  const line = text.trim();
  const prefix = line.match(numberedPrefix);
  return Boolean(prefix && line.length <= 36 && !/[。！？!?；;，,：:]/.test(line) && /\p{L}/u.test(line.slice(prefix[0].length)));
}

function median(values: number[]) {
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Layout cues only. A measured font size or a deviation from the college
// requirement must never enter the role classifier.
export function pdfHeadingFeatures(lines: readonly TextLine[], width: number, height: number): number[][] {
  const typicalLeft = median(lines.map(line => line.bbox[0]));
  const typicalWidth = median(lines.map(line => line.bbox[2] - line.bbox[0]));
  const gaps = lines.slice(1).map((line, i) => line.bbox[1] - lines[i].bbox[3]).filter(gap => gap > 0);
  const typicalGap = median(gaps) || height * .004;
  return lines.map((line, i) => {
    const [left, top, right, bottom] = line.bbox;
    const previous = lines[i - 1]?.bbox;
    const next = lines[i + 1]?.bbox;
    const text = line.text.trim();
    const above = previous ? Math.max(0, top - previous[3]) / height : 0;
    const below = next ? Math.max(0, next[1] - bottom) / height : 0;
    const compactText = text.replace(/\s/g, '');
    const han = compactText.match(/\p{Script=Han}/gu)?.length ?? 0;
    return [
      left / width,
      top / height,
      (right - left) / width,
      Math.abs((left + right - width) / width),
      (left - typicalLeft) / width,
      (right - left) / Math.max(1, typicalWidth),
      above,
      below,
      previous ? Math.abs(left - previous[0]) / width : 0,
      next ? Math.abs(left - next[0]) / width : 0,
      Math.min(compactText.length + han, 250),
      Number(sentenceEnd.test(text)),
      Number(numberedPrefix.test(text)),
      Number(!previous),
      Number(!next),
      previous ? (previous[2] - previous[0]) / Math.max(1, typicalWidth) : 0,
      next ? (next[2] - next[0]) / Math.max(1, typicalWidth) : 0,
      Math.min(above * height / typicalGap, 15),
      Math.min(below * height / typicalGap, 15),
      previous ? Number(sentenceEnd.test(lines[i - 1].text.trim())) : 0,
      next ? Number(sentenceEnd.test(lines[i + 1].text.trim())) : 0,
    ];
  });
}
