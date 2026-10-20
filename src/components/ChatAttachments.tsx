import { useState } from "react";
import { Download, File, Image, LoaderCircle, X } from "lucide-react";
import { attachmentUrl, cachedAttachmentUrl, downloadAttachment } from "../agents/attachment-client";
import { formatBytes, type ChatAttachment } from "../core/chat-content";

export function ChatAttachments({ items, sessionId, onRemove, onError }: { items: ChatAttachment[]; sessionId: string; onRemove?: (id: string) => void; onError: (message: string) => void }) {
  const [preview, setPreview] = useState<{ item: ChatAttachment; url?: string }>();
  const [pending, setPending] = useState<string>();
  const open = async (item: ChatAttachment) => {
    setPending(item.id);
    try {
      if (item.kind === "image") { setPreview({ item, url: cachedAttachmentUrl(item.id) }); const url = await attachmentUrl(item, sessionId); setPreview(current => current?.item.id === item.id ? { item, url } : current); }
      else await downloadAttachment(item, sessionId);
    } catch (error) { setPreview(undefined); onError(String(error)); }
    finally { setPending(undefined); }
  };
  return <>
    <div className="attachment-list">{items.map(item => <div className={`attachment-item ${item.kind}`} key={item.id}>
      <button type="button" className="attachment-open" title={item.kind === "image" ? `预览 ${item.name}` : `下载 ${item.name}`} aria-label={item.kind === "image" ? `预览 ${item.name}` : `下载 ${item.name}`} onClick={() => { void open(item); }}>
        {item.kind === "image" && item.thumbnail ? <img src={item.thumbnail} alt={item.name} /> : item.kind === "image" ? <Image size={20} /> : <File size={20} />}
        <span><strong>{item.name}</strong><small>{formatBytes(item.size)}</small></span>
        {pending === item.id && <LoaderCircle size={13} className="spin" />}
      </button>
      {onRemove && <button type="button" className="icon-button" title="移除附件" aria-label={`移除附件 ${item.name}`} onClick={() => onRemove(item.id)}><X size={13} /></button>}
    </div>)}</div>
    {preview && <div className="modal-backdrop attachment-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(undefined); }} onKeyDown={event => { if (event.key === "Escape") setPreview(undefined); }}>
      <section className="image-dialog" role="dialog" aria-modal="true" aria-label="图片预览">
        <div className="modal-heading"><strong>{preview.item.name}</strong><div><button type="button" className="icon-button" title="下载图片" aria-label="下载图片" onClick={() => { void downloadAttachment(preview.item, sessionId).catch(error => onError(String(error))); }}><Download size={16} /></button><button type="button" className="icon-button" autoFocus title="关闭图片预览" aria-label="关闭图片预览" onClick={() => setPreview(undefined)}><X size={17} /></button></div></div>
        {preview.url ? <img src={preview.url} alt={preview.item.name} /> : <div className="image-loading"><LoaderCircle className="spin" /></div>}
      </section>
    </div>}
  </>;
}
