import capabilities from "../shared/capabilities.json";
import { applyOperation, current, findEntry, importPackage, type Database, type Operation, type Run } from "./core/model";
import { createInitialDatabase } from "./core/samples";
import type { ConnectorStatus, Envelope } from "./core/protocol";
import { createSession, migrateSessions, requireSession, selectSession, syncChatProjection } from "./core/sessions";
import { validateDraft } from "./core/chat-content";

export const extensionMode = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const clientId = crypto.randomUUID();
const uiPort = extensionMode ? chrome.runtime.connect({ name: `bee:ui:${clientId}` }) : undefined;
window.addEventListener("pagehide", () => uiPort?.disconnect());
let webDatabase: Database;
function loadWeb(): Database {
  if (!webDatabase) {
    try { webDatabase = migrateSessions(JSON.parse(localStorage.getItem("beehelper.database") ?? "null") ?? createInitialDatabase(), true); }
    catch { webDatabase = migrateSessions(createInitialDatabase()); }
  }
  return webDatabase;
}
function saveWeb(db: Database) {
  syncChatProjection(db); webDatabase = db; localStorage.setItem("beehelper.database", JSON.stringify(db));
  window.dispatchEvent(new CustomEvent("bee:event", { detail: { type: "database" } }));
}
export async function request<T = any>(type: string, data: Record<string, unknown> = {}): Promise<T> {
  if (extensionMode) {
    const response = await chrome.runtime.sendMessage({ ...data, channel: "bee:request", clientId, type }) as Envelope<T>;
    if (!response?.ok) throw new Error(response?.error ?? "扩展没有响应");
    return response.data as T;
  }
  const db = loadWeb();
  if (type === "state") return { db, connector: { connected: false } as ConnectorStatus } as T;
  if (type === "setupStatus") return { completed: localStorage.getItem("beehelper.setupCompleted") === "true" } as T;
  if (type === "setupComplete") { localStorage.setItem("beehelper.setupCompleted", "true"); return true as T; }
  if (type === "setupSnapshot") return { extension: false, version: capabilities.version, scripts: false, connector: false, providers: [], completed: localStorage.getItem("beehelper.setupCompleted") === "true" } as T;
  if (type === "pageActivity") return { available: false, scriptsAvailable: false, items: [] } as T;
  if (type === "openInstallGuide") { window.open("https://github.com/Real-CyberBee/BeeHelper/blob/main/docs/getting-started.md", "_blank", "noopener"); return true as T; }
  if (type === "openExtensionDetails") throw new Error("请在安装扩展后打开浏览器扩展详情");
  if (type === "tabs") return [] as T;
  if (type === "scriptsStatus") return { available: false } as T;
  if (type === "providers") return [] as T;
  if (type === "sessionDraft") {
    const session = requireSession(db, data.sessionId as string | undefined);
    session.draft = validateDraft(data.draft); session.draftUpdatedAt = Number(data.updatedAt) || Date.now();
    saveWeb(db); return true as T;
  }
  if (type === "sessionNew" || type === "newChat") {
    const session = createSession(String(data.providerId ?? "codex")); db.sessions!.unshift(session);
    selectSession(db, session.id); saveWeb(db); return session as T;
  }
  if (type === "sessionSelect") { selectSession(db, String(data.sessionId)); saveWeb(db); return true as T; }
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
  if (type === "panelCapability") {
    const run = db.runs.find(item => item.id === data.runId);
    if (!run) throw new Error("界面实例已关闭");
    const capability = String(data.capability ?? "");
    const args = (data.args ?? {}) as Record<string, any>;
    if (capability === "appsList") return db.entries.map(entry => {
      const definition = current(entry).definition;
      return { id: entry.id, title: definition.title, description: definition.description, kind: definition.kind, installed: entry.installed, enabled: entry.enabled, favorite: entry.favorite, revisionId: entry.revisionId, revisionCount: entry.revisions.length };
    }) as T;
    if (capability === "appsUpdate") {
      if (typeof args.favorite === "boolean") saveWeb(applyOperation(db, { type: "favorite", id: String(args.id), value: args.favorite }).db);
      if (typeof args.enabled === "boolean") saveWeb(applyOperation(db, { type: "enable", id: String(args.id), value: args.enabled }).db);
      return { id: args.id } as T;
    }
    if (capability === "agentAsk") throw new Error("呼叫 AI 需要 Chrome 扩展并已连接 AI 客户端；网页预览没有会话连接");
    if (capability === "appsRun") throw new Error("网页预览只能从工作台运行微应用；请在 Chrome 扩展中试用其他微应用");
    throw new Error("此宿主能力需要 Chrome 扩展");
  }
  if (type === "userscriptSearch") throw new Error("脚本市场需要 Chrome 扩展：由后台统一抓取脚本源，避免网页跨域限制");
  if (type === "userscriptImport") throw new Error("导入脚本源内容需要 Chrome 扩展；也可以下载 .user.js 后从脚本市场离线导入");
  throw new Error("此操作需要 Chrome 扩展与本地 Agent 连接器");
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
