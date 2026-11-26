export type Stage = 'proposal' | 'midterm' | 'predefense';
export type MaterialKind = 'report' | 'thesis';
export type Status = 'fail' | 'warning' | 'manual' | 'pass' | 'not_applicable';
export const STAGES: Record<Stage, string> = { proposal: '开题', midterm: '中期', predefense: '预答辩' };
export const LABELS: Record<Status, string> = { fail: '明确不符', warning: '建议调整', manual: '需人工确认', pass: '已发现线索', not_applicable: '不适用' };
export interface Location { paragraph?: number; page?: number; bbox?: number[]; excerpt?: string; section?: number; objectId?: string }
export interface Run { text: string; font: string | null; size: number | null; spacing: number | null; origin: string }
export interface Paragraph {
  index: number; text: string; runs: Run[]; heading: boolean; level: number | null;
  toc: boolean; inTable: boolean; excluded: boolean; caption: boolean;
  lineRule: string | null; lineTwips: number | null; page?: number; bbox?: number[];
  previewText?: string;
  pdfMarkerBox?: number[]; // Bounds of a leading footnote number when PDF text items isolate it exactly.
  pdfRegion?: 'running' | 'footnote' | 'caption' | 'table';
  pdfHeadingCandidate?: true;
}
export interface Limitation { code: string; message: string; affectsPresence: boolean; page?: number }
export interface ObjectEvidence {
  kind: 'image' | 'table' | 'formula' | 'embedded'; location: Location; detail: string;
  id?: string; inline?: boolean; grouped?: boolean; hidden?: boolean; nested?: boolean; floating?: boolean;
  hasNested?: boolean; rows?: number; merged?: number;
}
export type DocumentBlock = { kind: 'paragraph'; paragraph: number } | { kind: 'table'; objectId: string } | { kind: 'unsupported' };
export interface ObjectReview {
  objectId: string; caption?: Location; captionText?: string;
  relation: 'before' | 'after' | 'unresolved' | 'not_applicable';
  position: Status; numbering: Status; reason: string; numberReason?: string;
}
export interface StructureReview { objects: ObjectReview[]; orphanCaptions: Location[]; scope: string }
export interface AuditDocument {
  name: string; format: 'docx' | 'pdf'; sha256: string; bytes: number;
  paragraphs: Paragraph[]; sections: { number: number; width: number | null; height: number | null; page?: number }[];
  objects: ObjectEvidence[]; limitations: Limitation[]; pageCount?: number;
  blocks?: DocumentBlock[];
}
export interface Rule {
  id: string; title: string; mode: string; stages: Stage[]; strength: string; note: string;
  source: { kind?: 'guide' | 'document'; pdf_page?: number; section: string; quote: string };
  params: { aliases?: string[]; kinds?: MaterialKind[]; expected_pt?: number; expected_twips?: number; minimum?: number; maximum?: number; width_mm?: number; height_mm?: number };
}
export interface RulePack { id: string; version: string; title: string; review_status: string; source: { sha256: string; document_date: string }; rules: Rule[]; scope_notes: string[] }
// Inclusive, one-based indices in the visible native runs of the source paragraph.
// text is a bounded quotation; location.excerpt remains the paragraph anchor.
export interface FormatSpan { firstRun: number; lastRun: number; text: string; truncated: boolean }
export interface CheckItem { location: Location; observed: string; expected?: string; status: Status; reason?: string; formatSpan?: FormatSpan }
export interface Check { rule: Rule; status: Status; summary: string; items: CheckItem[]; executed: boolean }
export interface Report {
  id: string; engine: string; stage: Stage; kind: MaterialKind; createdAt: string;
  document: AuditDocument; ruleVersion: string; checks: Check[]; elapsedMs: number;
  steps: { name: string; milliseconds: number; state: 'done' | 'manual' }[];
  structure?: StructureReview;
}
export interface Skill {
  id: string; version: string; name: string; stage: Stage; instructions: string[];
  tools: string[]; outputContract: string; references: string[];
}
export interface Settings {
  modelId: string; contextWindow: 2048 | 4096; maxTokens: number; temperature: number;
  autoLoadCached: boolean; disabledRules: string[];
}
export interface Explanation { issue_id: string; explanation: string; steps: string[] }
export function locationOf(p: Paragraph): Location {
  return { paragraph: p.index, page: p.page, bbox: p.bbox, excerpt: p.text.slice(0, 180) };
}
