import { LABELS, STAGES, type Report } from '../domain/types';
import { prettyItemPosition } from '../utils';

const ISSUE_STATUSES = ['fail', 'warning', 'manual'] as const;
const PREVIEW_LIMIT = 6;

function esc(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderPrintableSummary(report: Report): string {
  const applicable = report.checks.filter(check => check.executed && check.status !== 'not_applicable');
  const fails = applicable.filter(check => check.status === 'fail');
  const warnings = applicable.filter(check => check.status === 'warning');
  const manuals = applicable.filter(check => check.status === 'manual');
  const passes = applicable.filter(check => check.status === 'pass');

  const rows = [...fails, ...warnings, ...manuals].map(check => {
    const basis = check.rule.source.kind === 'document'
      ? '本稿内部对照'
      : `《撰写指南》第 ${check.rule.source.pdf_page} 页`;
    const findings = ISSUE_STATUSES.flatMap(status => check.items.filter(item => item.status === status));
    const itemLines = findings.slice(0, PREVIEW_LIMIT).map(item => {
      const position = prettyItemPosition(check.rule, item);
      const value = item.expected ? `${item.observed} → ${item.expected}` : item.observed;
      const quote = item.formatSpan ? `「${item.formatSpan.text}${item.formatSpan.truncated ? '…' : ''}」` : '';
      const reason = item.reason ? `。 ${esc(item.reason)}` : '';
      return `<li><strong>${esc(position)}</strong> · ${esc(LABELS[item.status])}${quote ? ` ${esc(quote)}` : ''}：${esc(value)}${reason}</li>`;
    }).join('');
    const more = findings.length > PREVIEW_LIMIT
      ? `<li class="more">其余 ${findings.length - PREVIEW_LIMIT} 处请在工作台内逐条查看</li>`
      : '';
    return `<tr>
      <td><span class="tag ${esc(check.status)}">${esc(LABELS[check.status])}</span></td>
      <td><div class="rule-name">${esc(check.rule.title)}</div><div class="rule-basis">${esc(basis)}</div></td>
      <td><p>${esc(check.summary)}</p>${itemLines ? `<ul>${itemLines}${more}</ul>` : ''}</td>
    </tr>`;
  }).join('');

  const created = new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false });
  const emptySummary = applicable.length ? '已执行的检查暂无偏差或待核对项。' : '当前没有已执行的适用检查项。';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/>
<title>论文审阅摘要 · ${esc(report.document.name)}</title>
<style>
  body{font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#262320;margin:32px auto;max-width:860px;padding:0 20px;line-height:1.6;font-size:13px}
  header{border-bottom:2px solid #262320;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
  h1{font-size:20px;margin:0 0 6px}
  .meta{color:#6e675f;font-size:12px;overflow-wrap:anywhere}
  .stats-caption{color:#6e675f;margin:0 0 8px;font-size:12px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
  .stat{border:1px solid #e4e0d8;border-radius:6px;padding:10px 14px;background:#faf9f6}
  .stat strong{display:block;font-size:20px;margin-bottom:2px}
  .stat.fail strong{color:#b8432e}.stat.warn strong{color:#9a6b2f}.stat.pass strong{color:#3b6e57}
  table{width:100%;border-collapse:collapse}
  th,td{border-top:1px solid #e4e0d8;padding:10px 8px;vertical-align:top;text-align:left}
  th{font-size:12px;color:#6e675f;border-top:0;border-bottom:1px solid #cfc9be}
  td{overflow-wrap:anywhere}
  .tag{display:inline-block;padding:2px 7px;border-radius:5px;font-size:11.5px;white-space:nowrap;background:#f0ede7;color:#524c46}
  .tag.fail{background:#fdf4f2;color:#b8432e}.tag.warning{background:#fbf6ec;color:#9a6b2f}
  .rule-name{font-weight:600;margin-bottom:3px}.rule-basis{font-size:11.5px;color:#7a736b}
  td p{margin:0 0 5px}td ul{margin:0;padding-left:16px;color:#524c46}td li{margin-bottom:3px}.more{color:#7a736b}
  footer{margin-top:24px;padding-top:12px;border-top:1px solid #e4e0d8;font-size:11.5px;color:#7a736b}
  @media screen and (max-width:560px){header{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:repeat(2,1fr)}th{width:auto!important}}
  @media print{body{margin:0;max-width:none}li{break-inside:avoid}}
</style></head><body>
<header>
  <div>
    <h1>论文格式审阅摘要报告</h1>
    <div class="meta">文稿：${esc(report.document.name)} · 阶段：${esc(STAGES[report.stage])}${report.kind === 'thesis' ? '论文稿' : '阶段报告'} · 生成时间：${esc(created)}</div>
  </div>
</header>
<p class="stats-caption">按已执行的检查规则计数</p>
<section class="stats">
  <div class="stat fail"><strong>${fails.length}</strong>明确不符项</div>
  <div class="stat warn"><strong>${warnings.length}</strong>建议调整项</div>
  <div class="stat"><strong>${manuals.length}</strong>需人工确认项</div>
  <div class="stat pass"><strong>${passes.length}</strong>已发现线索项</div>
</section>
<table>
  <thead><tr><th style="width:92px">状态</th><th style="width:210px">规则与依据</th><th>核对说明与位置摘录</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="3">${emptySummary}</td></tr>`}</tbody>
</table>
<footer>本报告由浏览器本地规则引擎生成（原稿未上传云端），仅供修改参考，不替代指导教师复核或学位评定结论。</footer>
</body></html>`;
}
