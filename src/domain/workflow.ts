import type { MaterialKind, Report, RulePack, Settings, Skill, Stage } from './types';
import { auditDocument, loadRules } from './rules';
import { loadSkill } from './config';
export interface WorkflowResult { report: Report; pack: RulePack; skill: Skill; buffer: ArrayBuffer }
export async function runWorkflow(file: File, stage: Stage, kind: MaterialKind, settings: Settings, progress: (message: string) => void): Promise<WorkflowResult> {
  const start = performance.now();
  if (file.size > 80 * 1024 * 1024) throw new Error('文件超过80 MiB试验上限。');
  if (!/\.(docx|pdf)$/i.test(file.name)) throw new Error('请选择DOCX或PDF文件。');
  progress('校验学院依据与阶段 Skill…');
  const [pack, skill, buffer] = await Promise.all([loadRules(), loadSkill(stage), file.arrayBuffer()]);
  const prepared = performance.now(); progress('读取原生文字与结构证据…');
  const document = /\.docx$/i.test(file.name)
    ? await (await import('../readers/docx')).readDocx(buffer, file.name, pack)
    : await (await import('../readers/pdf')).readPdf(buffer, file.name, pack, progress);
  const read = performance.now(); progress('执行当前阶段的规则核对…');
  const report = auditDocument(document, stage, kind, pack, settings);
  report.steps = [{ name: '规范与 Skill 校验', milliseconds: prepared - start, state: 'done' }, { name: '原生结构读取', milliseconds: read - prepared, state: 'done' }, { name: '规则核对', milliseconds: performance.now() - read, state: 'done' }, { name: '复杂图表 / 公式 / 扫描识别', milliseconds: 0, state: 'manual' }];
  report.elapsedMs = performance.now() - start;
  return { report, pack, skill, buffer };
}
