import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';
import type { Report } from '../domain/types';
import { renderPrintableSummary } from './printSummary';

export function PrintSummaryDialog({ report, onClose }: { report: Report; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => renderPrintableSummary(report), [report]);

  useLayoutEffect(() => { dialog.current?.showModal(); }, []);

  function print() {
    const preview = frame.current?.contentWindow;
    preview?.focus();
    preview?.print();
  }

  return <dialog className="print-summary-dialog" ref={dialog} aria-labelledby="print-summary-title" onClose={onClose}>
    <header>
      <h2 id="print-summary-title">审阅摘要预览</h2>
      <div className="print-summary-actions">
        <button type="button" className="primary small" disabled={!ready} onClick={print}>
          <Printer size={14} aria-hidden="true"/>打印 / 存为 PDF
        </button>
        <button type="button" className="icon-button" aria-label="关闭摘要预览" onClick={() => dialog.current?.close()}>
          <X size={16} aria-hidden="true"/>
        </button>
      </div>
    </header>
    <iframe ref={frame} title="论文格式审阅摘要报告" srcDoc={html} sandbox="allow-same-origin allow-modals"
      onLoad={() => setReady(true)}/>
  </dialog>;
}
