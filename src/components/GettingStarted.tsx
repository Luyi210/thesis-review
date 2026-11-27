import { useLayoutEffect, useRef } from 'react';
import { ArrowRight, Download, FileUp, GitCompare, LocateFixed, X } from 'lucide-react';
import { collegeModel } from '../model/college';
import { publicAsset } from '../utils';

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
      <div>
        <h2 id="guide-title">论文审阅使用说明</h2>
        <p id="guide-summary">原稿和批注联动，逐处核对学院要求和修改建议。</p>
        <a className="guide-word-download" href={publicAsset('manuals/thesis-workbench-guide-v0.8.3.docx')}
          download="学院论文审阅工作台使用说明书_v0.8.3.docx">
          <Download size={15} aria-hidden="true"/>
          下载 Word 说明书
        </a>
      </div>
      <button type="button" className="icon-button" aria-label="关闭使用说明" onClick={() => dialog.current?.close()}>
        <X size={18} aria-hidden="true"/>
      </button>
    </header>
    <div className="guide-body">
      <ol className="guide-workflow">
        <li>
          <span className="guide-step-icon"><FileUp size={17} aria-hidden="true"/></span>
          <div>
            <h3>选阶段，上传原稿</h3>
            <p>从顶部选「开题」「中期」或「预答辩」。开题和中期还要选「阶段报告」或「论文稿」。打开 Word（.docx）或 PDF 即可在浏览器里检查格式。</p>
          </div>
        </li>
        <li>
          <span className="guide-step-icon"><LocateFixed size={17} aria-hidden="true"/></span>
          <div>
            <h3>定位批注，对照要求</h3>
            <p>点原文标记，或从「全部批注」跳到对应位置。对照当前记录、学院要求和修改建议。遇到「待核对」时，先查看原稿。</p>
            <div className="guide-example">
              <span>字号示例</span>
              <strong>当前 10.5 磅</strong>
              <ArrowRight size={14} aria-hidden="true"/>
              <strong>要求小四（12 磅）</strong>
            </div>
          </div>
        </li>
        <li>
          <span className="guide-step-icon"><GitCompare size={17} aria-hidden="true"/></span>
          <div>
            <h3>修改后重传，核对两版</h3>
            <p>在首页点「对比原稿与修订稿」可直接体验。检查自己的稿件时，先在「对比」里设定对照，修改后重新上传。老师可在批注下填写「教师反馈」。</p>
          </div>
        </li>
      </ol>
      <section className="guide-model-note" aria-labelledby="guide-model-title">
        <h3 id="guide-model-title">可选的补充解释</h3>
        {collegeModel ? <p>在字号批注里展开「补充解释」，点「下载学院微调版（{collegeModel.download}）」。下载后会自动加载，再点「用学院微调版解释」。</p>
          : <p>在支持补充解释的批注里，点「下载或加载本机模型」。加载完成后，点「用本地模型解释这一处」。</p>}
        <p className="guide-model-detail">支持 WebGPU 的浏览器可在本机运行模型，首次下载后可复用缓存。</p>
      </section>
    </div>
    <footer>
      <p>可从「更多工具」重新打开</p>
      <button type="button" className="secondary" disabled={sampleDisabled} onClick={() => {
        dialog.current?.close();
        onSample();
      }}>打开完整演示稿</button>
      <button type="button" className="primary" ref={start} onClick={() => dialog.current?.close()}>开始使用</button>
    </footer>
  </dialog>;
}
