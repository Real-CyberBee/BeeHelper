import { applyOperation, findEntry, importPackage, type Database, type Operation, type Run } from "./core/model";
import { createInitialDatabase } from "./core/samples";
import type { ConnectorStatus, Envelope } from "./core/protocol";

export const extensionMode = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const clientId = crypto.randomUUID();
const uiPort = extensionMode ? chrome.runtime.connect({ name: `bee:ui:${clientId}` }) : undefined;
window.addEventListener("pagehide", () => uiPort?.disconnect());
let webDatabase: Database;
function loadWeb(): Database {
  if (!webDatabase) {
    try { webDatabase = JSON.parse(localStorage.getItem("beehelper.database") ?? "null") ?? createInitialDatabase(); }
    catch { webDatabase = createInitialDatabase(); }
  }
  return webDatabase;
}
function saveWeb(db: Database) {
  webDatabase = db; localStorage.setItem("beehelper.database", JSON.stringify(db));
  window.dispatchEvent(new CustomEvent("bee:event", { detail: { type: "database" } }));
}
export async function request<T = any>(type: string, data: Record<string, unknown> = {}): Promise<T> {
  if (extensionMode) {
    const response = await chrome.runtime.sendMessage({ channel: "bee:request", clientId, type, ...data }) as Envelope<T>;
    if (!response?.ok) throw new Error(response?.error ?? "扩展没有响应");
    return response.data as T;
  }
  const db = loadWeb();
  if (type === "state") return { db, connector: { connected: false } as ConnectorStatus } as T;
  if (type === "tabs") return [] as T;
  if (type === "scriptsStatus") return { available: false } as T;
  if (type === "operation") {
    const result = applyOperation(db, data.operation as Operation); saveWeb(result.db); return result.entry as T;
  }
  if (type === "import") {
    const entry = importPackage(String(data.text)); db.entries.unshift(entry); saveWeb(db); return entry as T;
  }
  if (type === "run") {
    const entry = findEntry(db, String(data.id));
    const revision = entry.revisions.find(item => item.id === data.revisionId);
    if (!revision) throw new Error("源码版本不存在");
    if (revision.definition.kind === "page") throw new Error("网页操作需要在 Chrome 中加载 BeeHelper 扩展");
    const run: Run = { id: crypto.randomUUID(), appId: entry.id, revisionId: revision.id, title: revision.definition.title, startedAt: Date.now(), status: "running", trial: !entry.installed, logs: [] };
    db.runs.unshift(run); saveWeb(db);
    window.dispatchEvent(new CustomEvent("bee:event", { detail: { type: "panelPreview", appId: entry.id, revisionId: revision.id, runId: run.id, definition: revision.definition } }));
    return { runId: run.id } as T;
  }
  if (type === "panelEvent" || type === "stop") {
    const run = db.runs.find(item => item.id === data.runId);
    if (run) {
      if (type === "stop") { run.status = "stopped"; window.dispatchEvent(new CustomEvent("bee:event", { detail: { type: "stopPanel", runId: run.id } })); }
      else { if (data.status) run.status = data.status as Run["status"]; run.logs.push({ time: Date.now(), level: String(data.level ?? "info"), text: String(data.text ?? "") }); }
    }
    saveWeb(db); return true as T;
  }
  if (type === "panelStorage") {
    const run = db.runs.find(item => item.id === data.runId);
    if (!run || run.status === "stopped") throw new Error("界面实例已关闭");
    const key = `beehelper.app:${run.appId}:${String(data.key)}`;
    if (data.method === "set") localStorage.setItem(key, JSON.stringify(data.value));
    return JSON.parse(localStorage.getItem(key) ?? "null") as T;
  }
  throw new Error("此操作需要 Chrome 扩展与本地 Codex 连接器");
}
export function subscribe(callback: (event: any) => void): () => void {
  if (extensionMode) {
    const listener = (message: any) => {
      if (message.channel !== "bee:event") return;
      if (message.event?.type === "panelPreview" && message.event.clientId && message.event.clientId !== clientId) return;
      callback(message.event);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }
  const listener = (event: Event) => callback((event as CustomEvent).detail);
  window.addEventListener("bee:event", listener);
  return () => window.removeEventListener("bee:event", listener);
}
