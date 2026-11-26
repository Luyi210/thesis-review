import type { Rule } from '../domain/types';
import { publicAsset } from '../utils';

export function RuleSource({ source, className }: { source: Rule['source']; className?: string }) {
  if (source.kind === 'document') return <span className={className} title={source.quote}>本稿内部对照</span>;
  return <a className={className} href={publicAsset(`rules/guide.pdf#page=${source.pdf_page}`)}
    title={`${source.section}　${source.quote}`} target="_blank" rel="noreferrer">《撰写指南》第 {source.pdf_page} 页</a>;
}
