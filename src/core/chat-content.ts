import limits from "../../shared/content-limits.json";

export { limits as contentLimits };
export interface ChatAttachment {
  id: string; name: string; mime: string; size: number; kind: "image" | "file";
  thumbnail?: string; createdAt: number;
}
export interface ChatReference {
  kind: "microapp" | "page" | "skill";
  id: string; label: string; revisionId?: string; url?: string;
}
export interface ChatDraft { text: string; attachments: ChatAttachment[]; references: ChatReference[] }
export interface AgentCommand { name: string; description: string; hint?: string }
export interface AgentSkill { id: string; name: string; description: string; scope?: string }
export interface AgentConfigOption {
  id: string; name: string; category?: string; type: "select" | "boolean"; currentValue: string | boolean;
  options?: { value: string; name: string }[];
}
export const emptyDraft = (): ChatDraft => ({ text: "", attachments: [], references: [] });
export function validateAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input) || input.length > limits.maxFiles) throw new Error(`每条消息最多 ${limits.maxFiles} 个附件`);
  let total = 0;
  const seen = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== "object") throw new Error("附件格式无效");
    const item = value as ChatAttachment;
    if (!/^[a-f0-9-]{36}$/i.test(item.id) || seen.has(item.id) || typeof item.name !== "string" || !item.name || item.name.length > 250 || typeof item.mime !== "string" || item.mime.length > 150 || !["image", "file"].includes(item.kind) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error("附件元数据无效或重复");
    seen.add(item.id); total += item.size;
    if (item.size > (item.kind === "image" ? limits.maxImageBytes : limits.maxFileBytes) || total > limits.maxMessageFileBytes) throw new Error("附件超过当前传输大小限制");
    const thumbnail = typeof item.thumbnail === "string" && item.thumbnail.length <= 30_000 && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(item.thumbnail) ? item.thumbnail : undefined;
    return { id: item.id, name: item.name, mime: item.mime, size: item.size, kind: item.kind, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), ...(thumbnail ? { thumbnail } : {}) };
  });
}
export function validateDraft(value: unknown): ChatDraft {
  if (!value || typeof value !== "object") throw new Error("草稿格式无效");
  const draft = value as ChatDraft;
  if (typeof draft.text !== "string" || draft.text.length > 50_000) throw new Error("消息超过 50000 字");
  if (!Array.isArray(draft.references) || draft.references.length > limits.maxReferences) throw new Error("引用数量过多");
  const references = draft.references.map(reference => {
    if (!reference || !["microapp", "page", "skill"].includes(reference.kind) || typeof reference.id !== "string" || reference.id.length > 200 || typeof reference.label !== "string" || reference.label.length > 250) throw new Error("引用格式无效");
    return { kind: reference.kind, id: reference.id, label: reference.label } as ChatReference;
  });
  return { text: draft.text, attachments: validateAttachments(draft.attachments), references };
}
export function commandToken(text: string): { name: string; args: string } | undefined {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? { name: match[1], args: match[2] ?? "" } : undefined;
}
export function completionToken(text: string, cursor: number) {
  const before = text.slice(0, cursor);
  const slash = /^\/([^\s]*)$/.exec(before);
  if (slash) return { kind: "command" as const, query: slash[1], start: 0, end: cursor };
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (mention) return { kind: "reference" as const, query: mention[1], start: cursor - mention[1].length - 1, end: cursor };
}
export function formatBytes(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
