import { useState } from "react";
import { LoaderCircle, Play, Plus, Sparkles, X } from "lucide-react";
import { demos, type Demo } from "../core/demos";

interface Props {
  busy?: boolean;
  addedTitles?: string[];
  onClose: () => void;
  onAdd: (demo: Demo, run: boolean) => Promise<void>;
  onAddAll: () => Promise<void>;
}

export function DemoGallery({ busy, addedTitles = [], onClose, onAdd, onAddAll }: Props) {
  const [working, setWorking] = useState<string>();
  const [addingAll, setAddingAll] = useState(false);
  async function add(demo: Demo, run: boolean) {
    setWorking(demo.id);
    try { await onAdd(demo, run); } finally { setWorking(undefined); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="gallery-title">
      <div className="modal-heading">
        <div className="modal-section-heading" style={{ margin: 0 }}>
          <Sparkles size={20} style={{ color: "#c0810c" }} />
          <h2 id="gallery-title">示例画廊</h2>
          <p>能跑、能改、能拆开学的微应用</p>
        </div>
        <button type="button" className="icon-button" title="关闭示例画廊" aria-label="关闭示例画廊" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="modal-intro">
        <strong>看完就能动手：</strong>每个示例都已写好源码，点「添加」进入候选库；「添加并试试」会直接运行一次。想让它们更像你自己的？把示例选中，然后对 AI 说「在这个基础上加……」，它会读源码接着改。
      </div>
      <div className="gallery-grid">
        {demos.map(demo => {
          const added = addedTitles.includes(demo.definition.title);
          return <article className="gallery-card" key={demo.id}>
            <div className="gallery-head">
              <span className="gallery-emoji" aria-hidden="true">{demo.emoji}</span>
              <h3>{demo.definition.title}</h3>
            </div>
            <p>{demo.tagline}</p>
            <div className="gallery-tags">{demo.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
            <div className="gallery-foot">
              <button type="button" className="mini gold" disabled={Boolean(working) || busy} onClick={() => void add(demo, false)}>{working === demo.id ? <LoaderCircle size={11} className="spin" /> : <Plus size={11} />}{added ? "再加一份" : "添加"}</button>
              <button type="button" className="mini" disabled={Boolean(working) || busy} onClick={() => void add(demo, true)}><Play size={11} />添加并试试</button>
              <small>{demo.definition.kind === "panel" ? "界面型" : "页面脚本"}</small>
            </div>
            <p className="gallery-tags" style={{ color: "#a3771a", fontSize: 10, margin: 0 }}>{demo.highlight}</p>
          </article>;
        })}
      </div>
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={addingAll || busy} onClick={async () => { setAddingAll(true); try { await onAddAll(); } finally { setAddingAll(false); } }}>{addingAll ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}全部添加到候选库</button>
        <button type="button" className="primary" onClick={onClose}>知道了</button>
      </div>
    </section>
  </div>;
}
