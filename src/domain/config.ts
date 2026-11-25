import { publicAsset } from '../utils';
import type { Settings, Skill, Stage } from './types';

export const MODELS = [
  { id: 'Qwen3-1.7B-q4f16_1-MLC', name: 'Qwen3 · 1.7B', download: '约 984 MB', estimatedMemory: '约 2.0 GB', role: '默认试验模型' },
  { id: 'Qwen3-0.6B-q4f16_1-MLC', name: 'Qwen3 · 0.6B', download: '约 352 MB', estimatedMemory: '约 1.4 GB', role: '较小模型对照' },
  { id: 'Qwen3-4B-q4f16_1-MLC', name: 'Qwen3 · 4B', download: '约 2.28 GB', estimatedMemory: '约 3.4 GB', role: '较大模型对照' },
] as const;
export const DEFAULT_SETTINGS: Settings = { modelId: MODELS[0].id, contextWindow: 4096, maxTokens: 400, temperature: .1, autoLoadCached: true, disabledRules: [] };
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('配置必须是 JSON 对象。');
  const s = value as Record<string, unknown>;
  if (!MODELS.some(m => m.id === s.modelId)) throw new Error('模型不在已核验的 WebLLM 预置清单中。');
  if (![2048, 4096].includes(Number(s.contextWindow))) throw new Error('上下文长度只支持 2048 或 4096。');
  if (!Number.isInteger(s.maxTokens) || Number(s.maxTokens) < 128 || Number(s.maxTokens) > 800) throw new Error('输出长度需为 128–800 的整数。');
  if (typeof s.temperature !== 'number' || !Number.isFinite(s.temperature) || s.temperature < 0 || s.temperature > .5) throw new Error('温度需为 0–0.5。');
  if (typeof s.autoLoadCached !== 'boolean') throw new Error('自动加载开关无效。');
  if (!Array.isArray(s.disabledRules) || s.disabledRules.length > 100 || s.disabledRules.some(x => typeof x !== 'string' || x.length > 80)) throw new Error('关闭规则列表无效。');
  return { modelId: String(s.modelId), contextWindow: Number(s.contextWindow) as Settings['contextWindow'], maxTokens: Number(s.maxTokens), temperature: s.temperature, autoLoadCached: s.autoLoadCached, disabledRules: [...s.disabledRules] as string[] };
}
export function readSettings(): Settings {
  try { const saved = localStorage.getItem('thesis-settings-v1'); return saved ? validateSettings(JSON.parse(saved)) : { ...DEFAULT_SETTINGS, disabledRules: [] }; }
  catch { return { ...DEFAULT_SETTINGS, disabledRules: [] }; }
}
export const RECOGNITION_ADAPTERS = [
  { id: 'docx-native', name: 'Word 原生结构', state: 'ready', detail: '读取文字与已支持格式；关联可确定的原生图表题注，核对源顺序及分章编号；提供图表公式覆盖清单。复杂对象继续人工确认。' },
  { id: 'pdf-native', name: 'PDF 原页与原生文字', state: 'ready', detail: 'PDF.js 原页渲染、文字位置与有效字号；复杂内容保留人工核对。' },
  { id: 'layout-tables', name: '版面与复杂表格识别', state: 'pending', detail: 'Docling / PP-StructureV3 待评测接入，目前不能据此审核 PDF 表格。' },
  { id: 'formula-ocr', name: '公式图片识别', state: 'pending', detail: 'PP-FormulaNet / pix2tex 待评测；当前只识别 Word 公式对象，不判断数学正确性。' },
  { id: 'image-ocr', name: '网页扫描件 OCR', state: 'pending', detail: 'Python 原型的 Tesseract 不冒充浏览器能力；本页扫描文字识别待接入。' },
] as const;
export async function loadSkill(stage: Stage): Promise<Skill> {
  const response = await fetch(publicAsset(`skills/${stage}.json`));
  if (!response.ok) throw new Error('阶段 Skill 配置读取失败。');
  const skill = await response.json() as Skill;
  if (skill.stage !== stage || !Array.isArray(skill.instructions) || !skill.instructions.length) throw new Error('Skill 阶段或内容无效。');
  const allowed = new Set(['native-reader', 'college-rule-engine', 'evidence-explainer']);
  if (!skill.tools.every(t => allowed.has(t))) throw new Error('Skill 引用了尚未注册的工具。');
  return skill;
}
