import { z } from "zod";
import type { ChatSession } from "./sessions";
import type { ChatAttachment, ChatReference } from "./chat-content";

export const DefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  kind: z.enum(["page", "panel"]),
  matches: z.array(z.string().min(1).max(2048)).min(1).max(32),
  trigger: z.enum(["manual", "page"]),
  code: z.string().min(1).max(1_000_000)
}).strict();
export type Definition = z.infer<typeof DefinitionSchema>;
export interface Revision { id: string; createdAt: number; definition: Definition; source: string }
export interface Entry { id: string; installed: boolean; enabled: boolean; favorite: boolean; revisionId: string; revisions: Revision[] }
export type RunStatus = "running" | "active" | "succeeded" | "failed" | "stopped" | "unknown";
export interface Run { id: string; appId: string; revisionId: string; title: string; tabId?: number; status: RunStatus; startedAt: number; logs: { time: number; level: string; text: string }[]; trial: boolean }
export interface ChatMessage {
  id: string; role: "user" | "assistant" | "tool" | "error"; text: string; time: number;
  delivery?: "queued" | "sending" | "sent" | "failed" | "unknown";
  attachments?: ChatAttachment[]; references?: ChatReference[];
  tool?: { id: string; title: string; status: string };
}
export interface Database { version: 1 | 2; entries: Entry[]; runs: Run[]; chat: ChatMessage[]; threadId?: string; sessions?: ChatSession[]; activeSessionId?: string }
export type Operation =
  | { type: "create"; definition: Definition; source?: string }
  | { type: "edit"; id: string; expectedRevision: string; definition: Definition; source?: string }
  | { type: "install"; id: string; revisionId: string }
  | { type: "favorite"; id: string; value: boolean }
  | { type: "enable"; id: string; value: boolean }
  | { type: "delete"; id: string }
  | { type: "restore"; id: string; revisionId: string; expectedRevision: string };

export function matchesUrl(pattern: string, url: string): boolean {
  let target: URL;
  try { target = new URL(url); } catch { return false; }
  if (!["http:", "https:"].includes(target.protocol)) return false;
  if (pattern === "<all_urls>") return true;
  const parsed = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!parsed) return false;
  const [, scheme, host, pathname] = parsed;
  if (scheme !== "*" && target.protocol !== `${scheme}:`) return false;
  const actual = target.hostname;
  const expected = host.replace(/:\d+$/, "");
  if (expected !== "*" && !(expected.startsWith("*.") ? actual === expected.slice(2) || actual.endsWith(`.${expected.slice(2)}`) : actual === expected)) return false;
  const expression = pathname.split("*").map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${expression}$`).test(target.pathname + target.search);
}

export function validateDefinition(value: unknown): Definition {
  const definition = DefinitionSchema.parse(value);
  if (definition.kind === "panel" && definition.trigger === "page") throw new Error("交互界面请使用主动运行；页面自动激活用于页面脚本");
  for (const pattern of definition.matches) {
    if (pattern !== "<all_urls>" && !/^(\*|https?):\/\/(\*|\*\.[a-zA-Z0-9.-]+|[a-zA-Z0-9.-]+)(\/.*)$/.test(pattern)) throw new Error(`无效页面匹配规则：${pattern}`);
  }
  return definition;
}
export function current(entry: Entry): Revision {
  const revision = entry.revisions.find(item => item.id === entry.revisionId);
  if (!revision) throw new Error("源码版本不存在");
  return revision;
}
export function findEntry(db: Database, id: string): Entry {
  const entry = db.entries.find(item => item.id === id);
  if (!entry) throw new Error("微应用不存在");
  return entry;
}
function makeRevision(definition: Definition, source: string): Revision {
  return { id: crypto.randomUUID(), createdAt: Date.now(), definition: validateDefinition(definition), source };
}
export function applyOperation(database: Database, operation: Operation): { db: Database; entry?: Entry } {
  const db = structuredClone(database);
  if (operation.type === "create") {
    const revision = makeRevision(operation.definition, operation.source ?? "手动");
    const entry: Entry = { id: crypto.randomUUID(), installed: false, enabled: true, favorite: false, revisionId: revision.id, revisions: [revision] };
    db.entries.unshift(entry);
    return { db, entry };
  }
  const entry = findEntry(db, operation.id);
  if (operation.type === "edit" || operation.type === "restore") {
    if (entry.revisionId !== operation.expectedRevision) throw new Error("源码已被其他操作修改，请刷新后再保存");
    const definition = operation.type === "edit" ? operation.definition : entry.revisions.find(item => item.id === operation.revisionId)?.definition;
    if (!definition) throw new Error("历史版本不存在");
    const revision = makeRevision(definition, operation.type === "edit" ? operation.source ?? "手动" : "恢复版本");
    entry.revisions.push(revision);
    entry.revisionId = revision.id;
  } else if (operation.type === "install") {
    if (!entry.revisions.some(item => item.id === operation.revisionId)) throw new Error("待安装版本不存在");
    entry.installed = true;
    entry.revisionId = operation.revisionId;
  } else if (operation.type === "favorite") entry.favorite = operation.value;
  else if (operation.type === "enable") entry.enabled = operation.value;
  else if (operation.type === "delete") db.entries = db.entries.filter(item => item.id !== entry.id);
  return { db, entry };
}
export function exportPackage(entry: Entry): string {
  if (entry.revisions.length > 500) throw new Error("历史版本超过当前包格式支持的 500 条，无法导出");
  const text = JSON.stringify({ format: "beehelper.microapp", version: 1, app: entry }, null, 2);
  if (new TextEncoder().encode(text).length > 5_000_000) throw new Error("完整历史超过 5 MB 包上限，无法导出");
  return text;
}
export function importPackage(text: string): Entry {
  if (new TextEncoder().encode(text).length > 5_000_000) throw new Error("微应用包超过 5 MB");
  const parsed = z.object({
    format: z.literal("beehelper.microapp"), version: z.literal(1),
    app: z.object({
      revisionId: z.string(),
      revisions: z.array(z.object({ id: z.string().min(1), createdAt: z.number().finite(), definition: DefinitionSchema, source: z.string().max(200) })).min(1).max(500)
    }).passthrough()
  }).parse(JSON.parse(text));
  if (new Set(parsed.app.revisions.map(item => item.id)).size !== parsed.app.revisions.length) throw new Error("微应用包包含重复版本");
  for (const revision of parsed.app.revisions) validateDefinition(revision.definition);
  const entry: Entry = { id: crypto.randomUUID(), installed: false, favorite: false, enabled: true, revisionId: parsed.app.revisionId, revisions: parsed.app.revisions };
  current(entry);
  return entry;
}
