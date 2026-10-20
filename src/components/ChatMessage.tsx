import { lazy, Suspense, useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import type { ChatMessage as Message } from "../core/model";
import { ChatAttachments } from "./ChatAttachments";

const deliveryLabels: Record<string, string> = { queued: "等待发送", sending: "投递中", failed: "投递失败", unknown: "投递结果未知" };
const stamp = (time: number) => new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const MarkdownMessage = lazy(() => import("./MarkdownMessage"));
export function ChatMessage({ message, agent, sessionId, onReuse, onError }: { message: Message; agent: string; sessionId: string; onReuse: (message: Message) => void; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const text = message.role === "assistant"
    ? <Suspense fallback={<div className="message-plain">{message.text}</div>}><MarkdownMessage text={message.text} onError={onError} /></Suspense>
    : <div className="message-plain">{message.text}</div>;
  return <div className={`message ${message.role}`}>
    <div className="message-label"><span>{message.role === "user" ? "你" : message.role === "assistant" ? agent : message.role === "tool" ? "工具" : "错误"}</span><time>{stamp(message.time)}</time>
      {message.role !== "tool" && <div className="message-actions">
        <button type="button" className="icon-button" title="复制消息文本" aria-label="复制消息文本" disabled={!message.text} onClick={() => { void navigator.clipboard.writeText(message.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(error => onError(String(error))); }}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>
        {message.role === "user" && <button type="button" className="icon-button" title="重用为新消息" aria-label="重用为新消息" onClick={() => onReuse(message)}><Pencil size={12} /></button>}
      </div>}
    </div>
    {message.role === "tool" ? <details className="tool-message"><summary>{message.tool?.title ?? message.text.slice(0, 120)}{message.tool?.status && <span>{message.tool.status}</span>}</summary><pre>{message.text}</pre></details> : text}
    {message.references?.length ? <div className="message-references">{message.references.map(ref => <span key={`${ref.kind}:${ref.id}`} title={ref.url ?? ref.label}>@{ref.label}</span>)}</div> : null}
    {message.attachments?.length ? <ChatAttachments items={message.attachments} sessionId={sessionId} onError={onError} /> : null}
    {message.delivery && deliveryLabels[message.delivery] && <small className={`message-delivery ${message.delivery}`}>{deliveryLabels[message.delivery]}</small>}
  </div>;
}
