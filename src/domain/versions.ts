import type { Check, Settings, Status } from './types';
import type { WorkflowResult } from './workflow';
import { digest } from '../readers/shared';

export interface VersionSnapshot { result: WorkflowResult; settings: Settings; rulesHash: string; guideHash: string }
export type ChangeKind = 'persisting' | 'not_observed' | 'newly_observed' | 'uncertain';
export const CHANGE_LABELS: Record<ChangeKind, string> = { persisting: '仍检出', not_observed: '本次未检出', newly_observed: '新增检出', uncertain: '无法判断' };
export interface ChangeRow { id: string; title: string; kind: ChangeKind; before?: Check; after?: Check; reason: string }
export interface Comparison { comparable: boolean; reasons: string[]; sameFile: boolean; rows: ChangeRow[]; basis: string }
const alert = (status?: Status) => status === 'fail' || status === 'warning';
export async function captureVersion(result: WorkflowResult, settings: Settings): Promise<VersionSnapshot> {
  const bytes = new TextEncoder().encode(JSON.stringify(result.pack)).buffer;
  return { result, settings: { ...settings, disabledRules: [...settings.disabledRules].sort() }, rulesHash: await digest(bytes), guideHash: result.pack.source.sha256 };
}
export function versionProvenance(snapshot: VersionSnapshot) {
  const { report } = snapshot.result;
  return { name: report.document.name, sha256: report.document.sha256, createdAt: report.createdAt, stage: report.stage, kind: report.kind, format: report.document.format, engine: report.engine, ruleVersion: report.ruleVersion, rulesHash: snapshot.rulesHash, guideHash: snapshot.guideHash, disabledRules: snapshot.settings.disabledRules };
}
export function compareVersions(before: VersionSnapshot, after: VersionSnapshot): Comparison {
  const a = before.result.report; const b = after.result.report; const reasons: string[] = [];
  if (a.stage !== b.stage) reasons.push('审核阶段不同');
  if (a.kind !== b.kind) reasons.push('材料类型不同');
  if (a.engine !== b.engine) reasons.push('检查引擎版本不同');
  if (a.ruleVersion !== b.ruleVersion || before.rulesHash !== after.rulesHash || before.guideHash !== after.guideHash) reasons.push('学院规则或依据不同');
  if (JSON.stringify([...before.settings.disabledRules].sort()) !== JSON.stringify([...after.settings.disabledRules].sort())) reasons.push('规则执行开关不同');
  if (a.document.format !== b.document.format) reasons.push('文档格式不同，读取覆盖范围不能直接等同');
  const sameFile = a.document.sha256 === b.document.sha256;
  const basis = '按规则项目对照，不自动匹配同一处错误；问题数量变化不等于逐处修复。未再检出可能来自修改、删除内容或识别范围变化，仍需核实。';
  if (reasons.length) return { comparable: false, reasons, sameFile, rows: [], basis };
  const previous = new Map(a.checks.map(c => [c.rule.id, c])); const current = new Map(b.checks.map(c => [c.rule.id, c]));
  const rows: ChangeRow[] = [];
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(id); const next = current.get(id); let kind: ChangeKind | null = null; let reason = '';
    if (!old || !next || !old.executed || !next.executed || old.status === 'not_applicable' || next.status === 'not_applicable') {
      if (alert(old?.status) || alert(next?.status) || old?.executed !== next?.executed) { kind = 'uncertain'; reason = '一版未执行、未应用或缺少此检查项，不能据此判断问题新增或消失。'; }
    } else if (alert(old.status) && alert(next.status)) { kind = 'persisting'; reason = '两版均检出此类问题；不表示已确认是同一个段落或同一个对象。'; }
    else if (alert(old.status) && next.status === 'pass') { kind = 'not_observed'; reason = '本版该项未检出偏差；请核实相关内容仍然存在且被完整覆盖，不能直接认定已修复。'; }
    else if (old.status === 'pass' && alert(next.status)) { kind = 'newly_observed'; reason = '本版首次检出这类偏差；可能与新增内容或可读取范围变化有关。'; }
    else if (alert(old.status) || alert(next.status) || old.status !== next.status) { kind = 'uncertain'; reason = '至少一版需要人工确认，或读取证据发生变化，不能确定修正情况。'; }
    if (kind) rows.push({ id, title: next?.rule.title || old!.rule.title, kind, before: old, after: next, reason });
  }
  return { comparable: true, reasons: [], sameFile, rows, basis };
}
export function occurrenceLabel(check?: Check): string {
  if (!check || !check.executed) return '未执行';
  const bad = check.items.filter(i => alert(i.status)).length;
  const manual = check.items.filter(i => i.status === 'manual').length;
  if (bad || manual) return `${bad}处偏差${manual ? ` / ${manual}处待确认` : ''}`;
  return alert(check.status) ? '项目级偏差（无逐处位置）' : '无逐处偏差记录';
}
export const SESSION_VERSION_LIMIT = 5;
export const SESSION_BYTE_LIMIT = 160 * 1024 * 1024;
export function retainVersions(history: VersionSnapshot[], next: VersionSnapshot, protectedId?: string | null): { history: VersionSnapshot[]; dropped: number } {
  const same = history.findIndex(v => v.result.report.document.sha256 === next.result.report.document.sha256 && compareVersions(v, next).comparable);
  // Keep a selected baseline immutable, even when the same bytes are checked again.
  let result = history.filter((v, i) => v.result.report.id !== next.result.report.id && (i !== same || v.result.report.id === protectedId));
  result.push(next); let dropped = 0;
  while (result.length > SESSION_VERSION_LIMIT || result.reduce((n, v) => n + v.result.buffer.byteLength, 0) > SESSION_BYTE_LIMIT) {
    const index = result.findIndex(v => v.result.report.id !== protectedId && v.result.report.id !== next.result.report.id);
    if (index < 0) break;
    result.splice(index, 1); dropped++;
  }
  return { history: result, dropped };
}
