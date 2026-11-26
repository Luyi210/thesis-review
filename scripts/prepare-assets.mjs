import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const core = path.resolve(root, '../审核核心试验版');
const publicDir = path.join(root, 'public');
await mkdir(path.join(publicDir, 'rules'), { recursive: true });
await mkdir(path.join(publicDir, 'samples'), { recursive: true });
// The authoring workspace has the original rule pack next to the frontend.
// A standalone checkout carries the published pack, guide and samples in public/.
const syncFromCore = existsSync(core);
const ruleFile = path.join(publicDir, 'rules/college.json');
const guideFile = path.join(publicDir, 'rules/guide.pdf');
const rules = await readFile(syncFromCore ? path.join(core, 'rules/fudan_education_2026.json') : ruleFile);
const guide = await readFile(syncFromCore ? path.join(core, 'rules/sources/撰写指南.pdf') : guideFile);
const source = JSON.parse(rules.toString());
if (createHash('sha256').update(guide).digest('hex') !== source.source.sha256) throw new Error('学院规则依据哈希不一致');
// Rebuild the browser-only document checks without adding invented guide clauses to the college source.
const documentChecks = JSON.parse(await readFile(new URL('./document-rules.json', import.meta.url), 'utf8'));
const collegeRules = source.rules.filter(rule => rule.source.kind !== 'document');
const publishedRules = [...collegeRules, ...documentChecks.rules];
if (new Set(publishedRules.map(rule => rule.id)).size !== publishedRules.length) throw new Error('规则编号重复');
const collegeVersion = source.version.replace(/\+doc\.\d+$/, '');
await writeFile(ruleFile, JSON.stringify({ ...source, version: collegeVersion + '+' + documentChecks.version, rules: publishedRules }, null, 2) + '\n');
if (syncFromCore) await writeFile(guideFile, guide);

const samples = [
  ['预答辩_含已知错误的样例.docx', 'known-errors.docx'],
  ['预答辩_基础格式符合的样例.docx', 'corrected-format.docx'],
  ['PDF/PDF_字号候选提示/PDF_字号候选提示.pdf', 'native-pdf.pdf'],
  ['PDF/PDF_混合页面图片声明/PDF_混合页面图片声明.pdf', 'mixed-pdf.pdf'],
];
for (const [original, name] of samples) {
  const target = path.join(publicDir, 'samples', name);
  if (syncFromCore) await cp(path.join(core, 'tests/样稿', original), target);
  else await access(target);
}
for (const name of ['structure-correct.docx', 'structure-mixed.docx']) await cp(path.join(root, 'tests/fixtures', name), path.join(publicDir, 'samples', name));
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(root, 'node_modules/pdfjs-dist', dir), path.join(publicDir, 'pdf-assets', dir), { recursive: true });
}
console.log('学院规则、哈希绑定指南、合成样稿及PDF运行资源已准备。');
