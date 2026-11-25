import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const loader = await createServer({ configFile: false, root, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
try {
  const { readDocx } = await loader.ssrLoadModule('/src/readers/docx.ts');
  const { auditDocument } = await loader.ssrLoadModule('/src/domain/rules.ts');
  const { DEFAULT_SETTINGS } = await loader.ssrLoadModule('/src/domain/config.ts');
  const { captureVersion, compareVersions, versionProvenance } = await loader.ssrLoadModule('/src/domain/versions.ts');
  const pack = JSON.parse(await readFile(path.join(root, 'public/rules/college.json'), 'utf8'));
  const skill = JSON.parse(await readFile(path.join(root, 'public/skills/predefense.json'), 'utf8'));
  const versions = [];
  for (const name of ['known-errors.docx', 'corrected-format.docx']) {
    const bytes = await readFile(path.join(root, 'public/samples', name)); const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const document = await readDocx(buffer, name, pack); const report = auditDocument(document, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
    versions.push(await captureVersion({ buffer, report, pack, skill }, DEFAULT_SETTINGS));
  }
  const comparison = compareVersions(versions[0], versions[1]);
  const actual = comparison.rows.filter(r => r.kind === 'not_observed').map(r => r.id).sort();
  const expected = ['FMT-FONT', 'FMT-LINE', 'FMT-SIZE', 'FMT-SPACING', 'KEYWORDS'];
  const passed = comparison.comparable && JSON.stringify(actual) === JSON.stringify(expected) && comparison.rows.every(r => r.kind === 'not_observed');
  const record = { appVersion: '0.5.0', method: 'Node executes native DOCX readers and version comparison; not a browser UI test', syntheticOnly: true, browserUiVerified: false,
    before: versionProvenance(versions[0]), after: versionProvenance(versions[1]), passed, expectedNotObserved: expected, ...comparison };
  await mkdir(path.join(root, '验证记录'), { recursive: true });
  await writeFile(path.join(root, '验证记录/版本对照合成评测_0.5.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ passed, notObserved: actual, browserUiVerified: false }, null, 2));
  if (!passed) process.exitCode = 1;
} finally { await loader.close(); }
