import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({ children, onError }: { children?: ReactNode; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  return <div className="markdown-code"><button type="button" className="icon-button" title="复制代码" aria-label="复制代码" onClick={event => {
    const text = event.currentTarget.parentElement?.querySelector("pre")?.textContent ?? "";
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(error => onError(String(error)));
  }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button><pre>{children}</pre></div>;
}
export default function MarkdownMessage({ text, onError }: { text: string; onError: (message: string) => void }) {
  return <div className="message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: ({ children }) => <CodeBlock onError={onError}>{children}</CodeBlock>,
    a: ({ href, children }) => <a href={href && /^https?:\/\//.test(href) ? href : undefined} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ src, alt }) => <a href={typeof src === "string" && /^https?:\/\//.test(src) ? src : undefined} target="_blank" rel="noreferrer">[图片{alt ? `：${alt}` : ""}]</a>,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>
  }}>{text}</ReactMarkdown></div>;
}
