import { useLayoutEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';
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
        <p id="guide-summary">在本机浏览器对照学院指南，逐处核对原稿格式。</p>
        <a className="guide-word-download" href={publicAsset('manuals/thesis-workbench-guide-v0.8.3.docx')}
          download="学院论文审阅工作台使用说明书_v0.8.3.docx">
          <Download size={15} aria-hidden="true"/>
          下载 Word 说明书
        </a>
      </div>
      <button type="button" className="icon-button" aria-label="关闭使用说明" onClick={() => dialog.current?.close()}>
        <X size={16} aria-hidden="true"/>
      </button>
    </header>
    <div className="guide-body">
      <ol className="guide-workflow">
        <li>
          <span className="guide-step-num" aria-hidden="true">01</span>
          <div>
            <h3>选阶段并打开原稿</h3>
            <p>顶部选「开题」「中期」或「预答辩」，再按需选择材料类型。拖入或选择 Word（.docx）或 PDF 文件。</p>
          </div>
        </li>
        <li>
          <span className="guide-step-num" aria-hidden="true">02</span>
          <div>
            <h3>用批注定位问题</h3>
            <p>点原文标记或从「全部批注」跳到对应位置，查看实测值、修改建议和《撰写指南》原页。</p>
          </div>
        </li>
        <li>
          <span className="guide-step-num" aria-hidden="true">03</span>
          <div>
            <h3>修改后重传对照</h3>
            <p>首页点「对比原稿与修订稿」可直接体验。核对自己的稿件时，先在「对比」中设好对照版本，修改后重新上传。</p>
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
      <button type="button" className="secondary small" disabled={sampleDisabled} onClick={() => {
        dialog.current?.close();
        onSample();
      }}>打开完整演示稿</button>
      <button type="button" className="primary small" ref={start} onClick={() => dialog.current?.close()}>开始使用</button>
    </footer>
  </dialog>;
}
