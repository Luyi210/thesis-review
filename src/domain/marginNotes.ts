import type { Check, CheckItem, Location, Report, Status } from './types';

export interface MarginSelection { id: string; item: number }
export interface MarginFinding { check: Check; item?: CheckItem; itemIndex: number; status: Status }
export interface MarginPosition { key: string; location?: Location; findings: MarginFinding[] }

const priority: Record<Status, number> = { fail: 0, warning: 1, manual: 2, pass: 3, not_applicable: 4 };
const reviewable = (status: Status) => status === 'fail' || status === 'warning' || status === 'manual';

export function marginLocationKey(location: Location | undefined, fallback: string, tableIds?: ReadonlySet<string>): string {
  if (location?.page && location.bbox?.length === 4) return `pdf:${location.page}:${location.bbox.join(',')}`;
  if (location?.objectId && tableIds?.has(location.objectId) && !location.excerpt) return `table:${location.objectId}`;
  if (location?.paragraph) return `paragraph:${location.page || 0}:${location.paragraph}`;
  if (location?.objectId) return `object:${location.objectId}`;
  if (location?.page || location?.section) return `scope:${location.page || 0}:${location.section || 0}`;
  // Identical excerpt strings can occur at different positions.
  return `finding:${fallback}`;
}

function isTextPosition(location?: Location) {
  return Boolean(location?.paragraph || location?.objectId || (location?.page && location.bbox));
}

export function buildMarginPositions(report: Report): MarginPosition[] {
  const positions = new Map<string, MarginPosition>();
  const tableIds = new Set(report.document.objects.filter(o => o.kind === 'table' && o.id).map(o => o.id!));
  function add(finding: MarginFinding) {
    const location = finding.item?.location;
    const key = marginLocationKey(location, `${finding.check.rule.id}:${finding.itemIndex}`, tableIds);
    const position = positions.get(key);
    if (position) position.findings.push(finding);
    else positions.set(key, { key, location, findings: [finding] });
  }
  for (const check of report.checks) {
    if (!check.executed || check.status === 'not_applicable') continue;
    let hasReviewItem = false;
    check.items.forEach((item, itemIndex) => {
      if (!reviewable(item.status)) return;
      hasReviewItem = true;
      add({ check, item, itemIndex, status: item.status });
    });
    // Some checks found positive evidence in one section but could not confirm
    // another. The uncertainty belongs to the check, not the positive item.
    if (!hasReviewItem && reviewable(check.status)) {
      add({ check, itemIndex: -1, status: check.status });
    }
  }
  for (const position of positions.values()) position.findings.sort((a, b) => priority[a.status] - priority[b.status]);
  return Array.from(positions.values()).sort((a, b) => {
    if (isTextPosition(a.location) !== isTextPosition(b.location)) return isTextPosition(a.location) ? -1 : 1;
    if (!isTextPosition(a.location)) return priority[a.findings[0].status] - priority[b.findings[0].status];
    return (a.location?.page || 0) - (b.location?.page || 0)
      || (a.location?.bbox?.[1] || 0) - (b.location?.bbox?.[1] || 0)
      || (a.location?.paragraph || 0) - (b.location?.paragraph || 0)
      || (a.location?.bbox?.[0] || 0) - (b.location?.bbox?.[0] || 0);
  });
}

export function marginInitialSelection(report: Report): MarginSelection | null {
  const positions = buildMarginPositions(report);
  const first = positions.find(p => p.findings[0].status !== 'manual')
    || positions.find(p => isTextPosition(p.location));
  const finding = first?.findings[0];
  return finding ? { id: finding.check.rule.id, item: finding.itemIndex } : null;
}

export function inspectMarginSelection(report: Report, positions: MarginPosition[], selected: MarginSelection | null): MarginPosition | undefined {
  if (!selected) return;
  const check = report.checks.find(c => c.rule.id === selected.id);
  if (!check) return;
  const itemIndex = check.items.length ? selected.item : -1;
  const match = positions.find(p => p.findings.some(f => f.check === check && f.itemIndex === itemIndex));
  if (match) return match;
  // Explicit drill-downs from the full record or a prior version also support
  // positive evidence and inapplicable rules without creating an error marker.
  const item = check.items[itemIndex];
  if (itemIndex !== -1 && !item) return;
  return { key: `record:${check.rule.id}:${itemIndex}`, location: item?.location,
    findings: [{ check, item, itemIndex, status: item?.status ?? check.status }] };
}

function setSizeLabel(expected: string) {
  return expected === '12 磅' ? '小四（12 磅）' : expected;
}
export function marginValues({ check, item }: MarginFinding) {
  if (!item) return;
  let { observed, expected } = item;
  if (check.rule.mode === 'body_size') {
    observed = observed.split('、').map(v => /^\d+(\.\d+)?$/.test(v) ? `${v} 磅` : v).join('、');
    if (expected) expected = setSizeLabel(expected);
  } else if (check.rule.mode === 'body_spacing') {
    const spacing = (n: number) => n === 0 ? '标准' : `${n > 0 ? '加宽' : '紧缩'} ${Math.abs(n) / 20} 磅`;
    observed = observed.split('、').map(v => /^-?\d+$/.test(v) ? spacing(Number(v)) : v).join('、');
    if (expected && /^-?\d+ twips$/.test(expected)) expected = spacing(parseInt(expected, 10));
  }
  return { observed, expected };
}

export function marginAdvice(finding: MarginFinding, report: Report): string | undefined {
  const { check, status, item } = finding;
  if (!check.executed || status === 'pass' || status === 'not_applicable') return;
  if (!item && check.items.length && (status === 'fail' || status === 'warning')) {
    return '在完整检查记录中选择一个具体位置，查看该处的依据和修改建议。';
  }
  const mode = check.rule.mode;
  const selection = item?.formatSpan ? '批注所引片段中的中文文字' : '这段中的中文正文';
  if (status === 'manual') {
    if (mode === 'heading') return '在原稿中找到相应栏目，核对标题和栏目内容。';
    if (mode.startsWith('caption_')) return '对照原稿中的图表和题注，确认题注归属及所在位置。';
    if (item?.formatSpan) return '在 Word 或 WPS 中选中批注所引片段中的中文文字，核对其字体设置。';
    if (report.document.format === 'pdf' && mode === 'body_size') return '在 Word 或 WPS 原稿中核对这行的字号。';
    if (mode.startsWith('body_')) return '在 Word 或 WPS 中选中对应正文，打开字体或段落设置核对。';
    if (mode === 'keywords' || mode === 'abstract_length' || mode === 'classification') return '打开原稿的摘要部分，对照本条指南核实。';
    return;
  }
  if (report.kind === 'report' && status === 'warning' && (mode.startsWith('body_') || mode === 'page_size')) {
    return '先确认本阶段报告是否沿用论文排版要求，再对照所列数值调整原稿。';
  }
  if (report.document.format === 'pdf' && mode === 'body_size') {
    return '先核实这行是否属于正文，再到 Word 或 WPS 原稿查看字号。';
  }
  switch (mode) {
    case 'footnote_brackets': {
      if (!item?.expected) return;
      const side = item.expected.startsWith(item.observed) ? '右' : '左';
      return `在原稿中给这个编号补上${side}方括号，写成 ${item.expected}。`;
    }
    case 'body_font': return `选中${selection}，在字体设置中选择宋体。`;
    case 'body_size': return `选中${selection}，将字号设为${setSizeLabel(item?.expected || `${check.rule.params.expected_pt} 磅`)}。`;
    case 'body_line': return `打开原稿的段落设置，将这段的行距调整为 ${check.rule.params.expected_pt} 磅。`;
    case 'body_spacing': return `选中${selection}，在字体的高级设置中将字符间距改为标准。`;
    case 'page_size': return report.document.format === 'pdf' ? '核实 PDF 的裁切范围，再检查原稿的纸张大小。' : '打开该节的页面设置，将纸张大小设为 A4。';
    case 'keywords': return `调整中文摘要末尾的关键词，保留 ${check.rule.params.minimum}–${check.rule.params.maximum} 个能概括论文内容的词语。`;
    case 'abstract_length': return '在原稿中单独选中摘要正文核对字数，再考虑是否调整篇幅。';
    case 'caption_position': return `核对原稿版面，将对应题注放到${item?.expected?.startsWith('表题') ? '表格上方' : '图片下方'}。`;
    case 'caption_number': return '按所在章核对同类图表题注的章号和顺序，并检查正文中对应的引用。';
    case 'ai_declaration': return '根据实际使用情况补充独立的 AI 使用声明。';
    default: return '在原稿中对照学院指南核实这一项。';
  }
}
