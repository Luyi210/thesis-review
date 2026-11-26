import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function GettingStarted({ onClose, onSample, sampleDisabled }: {
  onClose: () => void;
  onSample: () => void;
  sampleDisabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    dialog.current?.showModal();
    start.current?.focus();
  }, []);

  return <dialog ref={dialog} className="getting-started" aria-labelledby="guide-title"
    aria-describedby="guide-summary" onClose={onClose}>
    <header>
      <h2 id="guide-title">论文审阅工作台</h2>
      <button type="button" className="icon-button" aria-label="关闭使用说明" onClick={() => dialog.current?.close()}>
        <X size={18} aria-hidden="true"/>
      </button>
    </header>
    <p id="guide-summary">在原稿旁查看学院格式要求、逐处批注和修改建议。</p>
    <dl className="guide-workflow">
      <div><dt>上传原稿</dt><dd>选开题、中期或预答辩，再上传 Word（DOCX）或 PDF。</dd></div>
      <div><dt>查看批注</dt><dd>点左侧原文标记，或从右侧「全部批注」跳到对应位置。</dd></div>
      <div><dt>复核修订</dt><dd>在 Word 或 WPS 修改后重传，点「对比」查看两版结果。老师也可以在批注下填写反馈。</dd></div>
    </dl>
    <p className="guide-model-note">格式检查打开就能用。需要补充解释时，在批注里点「下载或加载本机模型」，首次会下载模型。</p>
    <footer>
      <button type="button" className="secondary" disabled={sampleDisabled} onClick={() => {
        dialog.current?.close();
        onSample();
      }}>打开示例稿</button>
      <button type="button" className="primary" ref={start} onClick={() => dialog.current?.close()}>开始使用</button>
    </footer>
  </dialog>;
}
