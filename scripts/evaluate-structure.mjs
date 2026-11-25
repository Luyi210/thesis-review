import { createServer } from 'vite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = JSON.parse(await readFile(path.join(root, 'tests/fixtures/structure-golden.json'), 'utf8'));
const pack = JSON.parse(await readFile(path.join(root, 'public/rules/college.json'), 'utf8'));
const guide = await readFile(path.join(root, 'public/rules/guide.pdf'));
if (createHash('sha256').update(guide).digest('hex') !== pack.source.sha256) throw new Error('Guide hash mismatch');
// Vite is used only as a TypeScript module loader. No HTTP port is opened.
const loader = await createServer({ configFile: false, root, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
let tp = 0; let fp = 0; let fn = 0;
try {
  const { readDocx } = await loader.ssrLoadModule('/src/readers/docx.ts');
  const { auditDocument } = await loader.ssrLoadModule('/src/domain/rules.ts');
  const { DEFAULT_SETTINGS } = await loader.ssrLoadModule('/src/domain/config.ts');
  const cases = [];
  for (const test of expected.cases) {
    const bytes = await readFile(path.join(root, 'tests/fixtures', test.file));
    const doc = await readDocx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), test.file, pack);
    const report = auditDocument(doc, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
    const detected = new Set(); const truth = new Set();
    for (const [mode, key] of [['caption_position', 'position_fail_paragraphs'], ['caption_number', 'number_fail_paragraphs']]) {
      report.checks.find(c => c.rule.mode === mode).items.filter(i => i.status === 'fail').forEach(i => detected.add(`${mode}:${i.location.paragraph}`));
      test[key].forEach(p => truth.add(`${mode}:${p}`));
    }
    const falsePositives = [...detected].filter(k => !truth.has(k)); const falseNegatives = [...truth].filter(k => !detected.has(k));
    tp += [...detected].filter(k => truth.has(k)).length; fp += falsePositives.length; fn += falseNegatives.length;
    const counts = Object.fromEntries(['image', 'table', 'formula'].map(kind => [kind, doc.objects.filter(o => o.kind === kind).length]));
    const linked = report.structure.objects.filter(r => r.caption).length;
    const pending = report.structure.objects.filter(r => r.relation === 'unresolved').length;
    const orphans = report.structure.orphanCaptions.length;
    const coverageMatches = JSON.stringify(counts) === JSON.stringify(test.objects) && linked === test.linked_captions && pending === test.unresolved_graphic_objects && orphans === test.orphan_captions;
    cases.push({ file: test.file, sha256: doc.sha256, detected: [...detected], expected: [...truth], falsePositives, falseNegatives, objects: counts, linked, pending, orphans, coverageMatches, passed: !falsePositives.length && !falseNegatives.length && coverageMatches });
  }
  const result = { date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()), engine: 'browser-audit-0.4.0', scope: expected.scope, ruleVersion: pack.version, guideSha256: pack.source.sha256,
    metrics: { labelledRuleOccurrences: tp + fn, truePositives: tp, falsePositives: fp, falseNegatives: fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null },
    caveat: '仅两份程序合成DOCX及五条标注偏差；不能外推真实论文准确率。教师确认的独立学院样稿评测尚未完成。', cases };
  await mkdir(path.join(root, '验证记录'), { recursive: true });
  await writeFile(path.join(root, '验证记录/图表结构合成评测_0.4.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, passed: cases.every(c => c.passed), ...result.metrics, caveat: result.caveat }, null, 2));
  if (cases.some(c => !c.passed)) process.exitCode = 1;
} finally { await loader.close(); }
