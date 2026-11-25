import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readDocx } from '../src/readers/docx';
import { auditDocument } from '../src/domain/rules';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { captureVersion, compareVersions } from '../src/domain/versions';
import { VersionsPanel } from '../src/components/VersionsPanel';
import type { RulePack, Skill } from '../src/domain/types';

const pack: RulePack = JSON.parse(await readFile('public/rules/college.json', 'utf8'));
const skill: Skill = JSON.parse(await readFile('public/skills/predefense.json', 'utf8'));
async function load(name: string) {
  const b = await readFile(`public/samples/${name}`); const buffer = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const document = await readDocx(buffer, name, pack); const report = auditDocument(document, 'predefense', 'thesis', pack, DEFAULT_SETTINGS);
  return captureVersion({ buffer, report, pack, skill }, DEFAULT_SETTINGS);
}
const wrong = await load('known-errors.docx'); const corrected = await load('corrected-format.docx');
describe('actual DOCX version comparison', () => {
  it('reports only the five previously known deviations as not observed in the corrected fixture', () => {
    const r = compareVersions(wrong, corrected); expect(r.comparable).toBe(true);
    expect(r.rows.filter(r => r.kind === 'not_observed').map(r => r.id).sort()).toEqual(['FMT-FONT', 'FMT-LINE', 'FMT-SIZE', 'FMT-SPACING', 'KEYWORDS']);
    expect(r.rows.filter(r => r.kind === 'newly_observed')).toHaveLength(0);
    expect(r.rows.every(r => r.kind === 'not_observed')).toBe(true);
  });
  it('reversing the chosen baseline reverses the comparison direction', () => {
    const r = compareVersions(corrected, wrong); expect(r.rows.filter(r => r.kind === 'newly_observed')).toHaveLength(5); expect(r.rows.filter(r => r.kind === 'not_observed')).toHaveLength(0);
  });
  it('renders all five corrections with a human verification caveat and session-only disclosure', () => {
    const markup = renderToStaticMarkup(createElement(VersionsPanel, { versions: [wrong, corrected], current: corrected, baseline: wrong, onBaseline: () => {}, onView: () => {}, onSelect: () => {}, locked: false }));
    expect(markup).toContain('本次未检出'); expect(markup).toContain('不能直接认定已修复'); expect(markup).toContain('刷新即清空'); expect(markup).toContain('不是教师提交记录'); expect(markup).toContain('查看本版检查证据'); expect(markup).toContain('正文中文字体为宋体');
  });
  it('renders a blocked comparison after a stage change without claiming improvement', () => {
    const other = structuredClone(corrected); other.result.report.stage = 'midterm';
    const markup = renderToStaticMarkup(createElement(VersionsPanel, { versions: [wrong, other], current: other, baseline: wrong, onBaseline: () => {}, onView: () => {}, onSelect: () => {}, locked: false }));
    expect(markup).toContain('审核阶段不同'); expect(markup).toContain('不能直接判断修正情况'); expect(markup).not.toContain('class="change-row');
  });
});
