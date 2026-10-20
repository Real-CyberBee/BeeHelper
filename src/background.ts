import { createPluginHost } from "./core/plugins";
import { applyOperation, current, findEntry, importPackage, matchesUrl, validateDefinition, type Database, type Operation, type Run } from "./core/model";
import { createInitialDatabase } from "./core/samples";
import { HOST_NAME, type ConnectorStatus, type NativeMessage } from "./core/protocol";
import { pageProgram, stopProgram } from "./runtime";
import { browserAction, inspectPage } from "./browser-tools";
import capabilities from "../shared/capabilities.json";
import { buildAgentContext, getRun, listRuns } from "./core/agent-context";

let db: Database;
let transaction: Promise<unknown> = Promise.resolve();
let port: chrome.runtime.Port | undefined;
let connector: ConnectorStatus = { connected: false };
let activeClientId: string | undefined;
const uiClients = new Set<string>();
const panelOwners = new Map<string, string>();
const pendingDeltas = new Map<string, string>();
let deltaTimer: ReturnType<typeof setTimeout> | undefined;
const nativePending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
const activeRuns = new Map<string, { appId: string; runId: string; tabId: number; url: string; revisionId: string; documentId?: string; clientId?: string }>();
const storeReady = chrome.storage.local.get("database").then(async ({ database }) => {
  db = (database as Database | undefined) ?? createInitialDatabase();
  for (const run of db.runs) if (run.status === "running" || run.status === "active") run.status = "unknown";
  await chrome.storage.local.set({ database: db });
});
function broadcast(event: unknown) { void chrome.runtime.sendMessage({ channel: "bee:event", event }).catch(() => {}); }
async function mutate<T>(callback: (database: Database) => T): Promise<T> {
  const next = transaction.catch(() => {}).then(async () => {
    await storeReady;
    const updated = structuredClone(db);
    const result = callback(updated);
    await chrome.storage.local.set({ database: updated });
    db = updated;
    broadcast({ type: "database" });
    return result;
  });
  transaction = next;
  return next;
}
async function logRun(id: string, level: string, text: string, status?: Run["status"]) {
  await mutate(database => {
    const run = database.runs.find(item => item.id === id);
    if (!run) return;
    run.logs.push({ time: Date.now(), level, text: text.slice(0, 50_000) });
    run.logs = run.logs.slice(-150);
    if (status) run.status = status;
  });
}
function flushDeltas() {
  clearTimeout(deltaTimer); deltaTimer = undefined;
  if (!pendingDeltas.size) return;
  const batch = [...pendingDeltas]; pendingDeltas.clear();
  void mutate(database => {
    for (const [id, text] of batch) {
      const existing = database.chat.find(message => message.id === id);
      if (existing) existing.text += text;
      else database.chat.push({ id, role: "assistant", text, time: Date.now() });
    }
    database.chat = database.chat.slice(-100);
  });
}
async function availableScripts() {
  try { await chrome.userScripts.getScripts(); }
  catch { throw new Error("请在 Chrome 扩展详情中开启「允许用户脚本」，然后重试"); }
}
async function targetTabs() {
  const tabs = await chrome.tabs.query({});
  const focused = await chrome.windows.getLastFocused();
  return tabs.filter(tab => tab.id !== undefined && /^https?:/.test(tab.url ?? "")).map(tab => ({ id: tab.id!, title: tab.title ?? "", url: tab.url!, active: tab.active && tab.windowId === focused.id }));
}
async function stopApp(appId: string, tabId?: number) {
  for (const [key, active] of [...activeRuns]) {
    if (active.appId !== appId || (tabId !== undefined && active.tabId !== tabId)) continue;
    try { await chrome.userScripts.execute({ target: { tabId: active.tabId, ...(active.documentId ? { documentIds: [active.documentId] } : {}) }, js: [{ code: stopProgram(appId) }] }); } catch { /* 页面可能已关闭或导航。 */ }
    activeRuns.delete(key);
    await logRun(active.runId, "info", "已结束页面实例；外部业务操作不会回滚", "stopped");
  }
}
async function runApp(appId: string, revisionId: string, tabId?: number, automatic = false, clientId = activeClientId) {
  await storeReady;
  const entry = findEntry(db, appId);
  const revision = entry.revisions.find(item => item.id === revisionId);
  if (!revision) throw new Error("待执行版本不存在");
  const definition = revision.definition;
  if (definition.kind === "page") {
    if (tabId === undefined) throw new Error("请选择目标网页");
    await availableScripts();
    const tab = await chrome.tabs.get(tabId);
    if (!definition.matches.some(pattern => matchesUrl(pattern, tab.url ?? ""))) throw new Error("微应用不匹配所选网页，请修改页面匹配规则");
    const key = `${tabId}:${appId}`;
    const previous = activeRuns.get(key);
    if (automatic && previous?.revisionId === revisionId && previous.url === tab.url) return { runId: previous.runId, reused: true };
    await stopApp(appId, tabId);
  }
  const run: Run = { id: crypto.randomUUID(), appId, revisionId, title: definition.title, ...(definition.kind === "page" ? { tabId } : {}), status: "running", startedAt: Date.now(), trial: !entry.installed, logs: [] };
  await mutate(database => { database.runs.unshift(run); database.runs = database.runs.slice(0, 100); });
  if (definition.kind === "panel") {
    const owner = clientId ?? uiClients.values().next().value;
    if (!owner || !uiClients.has(owner)) { await logRun(run.id, "error", "请打开发起任务的 BeeHelper 工作台后再查看效果", "failed"); throw new Error("BeeHelper 界面已关闭，无法显示效果"); }
    panelOwners.set(run.id, owner);
    broadcast({ type: "panelPreview", appId, revisionId, runId: run.id, definition, clientId: owner });
    return { runId: run.id, status: "running", message: "界面预览已请求，请保持 BeeHelper 工作台打开" };
  }
  const key = `${tabId}:${appId}`;
  try {
    const tab = await chrome.tabs.get(tabId!);
    const frame = await chrome.webNavigation.getFrame({ tabId: tabId!, frameId: 0 });
    if (!frame?.documentId || frame.url !== tab.url || !definition.matches.some(pattern => matchesUrl(pattern, tab.url ?? ""))) throw new Error("目标文档已变化，请重新选择页面再运行");
    const active = { appId, runId: run.id, tabId: tabId!, url: tab.url!, revisionId, documentId: frame.documentId, clientId };
    activeRuns.set(key, active);
    await chrome.userScripts.configureWorld({ messaging: true });
    const results = await chrome.userScripts.execute({ target: { tabId: tabId!, documentIds: [frame.documentId] }, js: [{ code: pageProgram({ appId, runId: run.id, definition }) }] });
    active.documentId = results[0]?.documentId;
  } catch (error) {
    activeRuns.delete(key);
    await logRun(run.id, "error", String(error), "failed");
    throw error;
  }
  return { runId: run.id };
}
async function reconcileTab(tabId: number, url: string) {
  await storeReady;
  for (const active of [...activeRuns.values()]) {
    if (active.tabId !== tabId) continue;
    const entry = db.entries.find(item => item.id === active.appId);
    if (!entry || (entry.installed && !entry.enabled) || !current(entry).definition.matches.some(pattern => matchesUrl(pattern, url)) || active.url !== url) await stopApp(active.appId, tabId);
  }
  for (const entry of db.entries) {
    const definition = current(entry).definition;
    if (entry.installed && entry.enabled && definition.kind === "page" && definition.trigger === "page" && definition.matches.some(pattern => matchesUrl(pattern, url))) {
      try { await runApp(entry.id, entry.revisionId, tabId, true); } catch (error) { broadcast({ type: "error", message: String(error) }); }
    }
  }
}
async function capability(appId: string, type: string, data: any = {}): Promise<unknown> {
  if (type === "storageGet" || type === "storageSet") {
    const key = `app:${appId}:${String(data.key).slice(0, 200)}`;
    if (type === "storageSet") await chrome.storage.local.set({ [key]: data.value });
    return (await chrome.storage.local.get(key))[key] ?? null;
  }
  if (type === "tabsList") return targetTabs();
  if (type === "tabsInspect") return inspectPage(Number(data.tabId));
  if (type === "tabsAction") return browserAction(data);
  if (type === "tabsOpen") {
    const url = new URL(data.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS 网页");
    const tab = await chrome.tabs.create({ url: url.href }); return { id: tab.id, url: tab.url };
  }
  throw new Error("未知微应用能力");
}
async function invokeTool(name: string, args: any): Promise<unknown> {
  await storeReady;
  await transaction.catch(() => {});
  if (name === "capabilities_get") {
    let userScriptsAvailable = true;
    try { await availableScripts(); } catch { userScriptsAvailable = false; }
    return { ...capabilities, userScriptsAvailable };
  }
  if (name === "microapp_list") return db.entries.map(entry => ({ id: entry.id, installed: entry.installed, revisionId: entry.revisionId, ...current(entry).definition }));
  if (name === "microapp_get") return findEntry(db, args.id);
  if (name === "microapp_create") return (await mutate(database => {
    const result = applyOperation(database, { type: "create", definition: validateDefinition(args.definition), source: "Codex" }); Object.assign(database, result.db); return result.entry;
  }));
  if (name === "microapp_update") return (await mutate(database => {
    const result = applyOperation(database, { type: "edit", id: args.id, expectedRevision: args.expectedRevision, definition: validateDefinition(args.definition), source: "Codex" }); Object.assign(database, result.db); return result.entry;
  }));
  if (name === "microapp_run") return runApp(args.id, args.revisionId, args.tabId);
  if (name === "microapp_install") return handle({ type: "operation", operation: { type: "install", id: args.id, revisionId: args.revisionId } });
  if (name === "run_list") return listRuns(db, args);
  if (name === "run_get") return getRun(db, args);
  if (name === "browser_tabs") return targetTabs();
  if (name === "browser_inspect") return inspectPage(args.tabId, { selector: args.selector, limit: args.limit });
  if (name === "browser_action") return browserAction(args);
  if (name === "browser_open") {
    const url = new URL(args.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS 网页");
    const tab = await chrome.tabs.create({ url: url.href }); return { tabId: tab.id, url: tab.url };
  }
  throw new Error(`未知工具：${name}`);
}
function connectNative() {
  if (port) return;
  port = chrome.runtime.connectNative(HOST_NAME);
  connector = { connected: true };
  port.onDisconnect.addListener(() => {
    connector = { connected: false, error: chrome.runtime.lastError?.message ?? "连接器已断开" };
    port = undefined;
    for (const pending of nativePending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(connector.error)); }
    nativePending.clear();
    broadcast({ type: "connector", status: connector });
  });
  port.onMessage.addListener((message: NativeMessage) => {
    if (message.kind === "reply" && message.id) {
      const pending = nativePending.get(message.id);
      if (pending) { clearTimeout(pending.timeout); nativePending.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
    } else if (message.kind === "tool") {
      void invokeTool(message.name!, message.args).then(result => port?.postMessage({ kind: "toolResult", id: message.id, result }), error => port?.postMessage({ kind: "toolResult", id: message.id, error: String(error) }));
    } else if (message.kind === "event" && message.event) {
      const event = message.event;
      if (event.type === "status") connector = { connected: true, ready: true, ...event.status as object };
      if (event.type === "busy") connector.busy = Boolean(event.value);
      if (event.type === "done") connector.busy = false;
      if (event.type === "thread" && typeof event.threadId === "string") void mutate(database => { database.threadId = event.threadId as string; });
      if (event.type === "delta" && typeof event.text === "string") {
        const id = String(event.messageId);
        pendingDeltas.set(id, (pendingDeltas.get(id) ?? "") + event.text);
        deltaTimer ??= setTimeout(flushDeltas, 80);
        return;
      } else if (event.type === "tool" || event.type === "error") {
        flushDeltas();
        void mutate(database => { database.chat.push({ id: crypto.randomUUID(), role: event.type === "error" ? "error" : "tool", text: String(event.message), time: Date.now() }); database.chat = database.chat.slice(-100); });
      }
      if (event.type === "done") flushDeltas();
      broadcast(event);
    }
  });
}
async function nativeRpc(method: string, params: unknown = {}) {
  connectNative();
  const id = crypto.randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => { nativePending.delete(id); reject(new Error("连接器请求超时")); }, 60_000);
    nativePending.set(id, { resolve, reject, timeout });
    port!.postMessage({ kind: "rpc", id, method, params });
  });
}
const plugins = createPluginHost([
  { name: "local-library", services: { store: { mutate } } },
  { name: "page-runtime", services: { runtime: { run: runApp, stop: stopApp } } },
  { name: "codex-connector", services: { agent: { request: nativeRpc } } }
]);

async function handle(message: any, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  await storeReady;
  switch (message.type) {
    case "state": return { db, connector };
    case "tabs": return targetTabs();
    case "scriptsStatus":
      try { await availableScripts(); return { available: true }; } catch (error) { return { available: false, error: String(error) }; }
    case "operation": {
      const operation = message.operation as Operation;
      const result = await plugins.get<{ mutate: typeof mutate }>("store").mutate(database => {
        const changed = applyOperation(database, operation); Object.assign(database, changed.db); return changed.entry;
      });
      if (operation.type === "delete" || (operation.type === "enable" && !operation.value)) {
        await stopApp(operation.id);
        const panels = db.runs.filter(run => run.appId === operation.id && run.tabId === undefined && ["running", "active"].includes(run.status));
        for (const run of panels) { await logRun(run.id, "info", "微应用已停用", "stopped"); broadcast({ type: "stopPanel", runId: run.id }); }
      }
      if (operation.type === "install") {
        for (const active of [...activeRuns.values()]) {
          if (active.appId !== operation.id) continue;
          if (active.revisionId !== operation.revisionId) await stopApp(active.appId, active.tabId);
          else await mutate(database => { const run = database.runs.find(item => item.id === active.runId); if (run) run.trial = false; });
        }
      }
      if (["install", "enable", "edit", "restore"].includes(operation.type)) for (const tab of await targetTabs()) await reconcileTab(tab.id, tab.url);
      if (["install", "enable", "delete"].includes(operation.type)) for (const tab of await targetTabs()) void chrome.tabs.sendMessage(tab.id, { channel: "bee:event", event: { type: "database" } }).catch(() => {});
      return result;
    }
    case "import": {
      const entry = importPackage(message.text);
      await mutate(database => { database.entries.unshift(entry); });
      return entry;
    }
    case "run": return plugins.get<{ run: typeof runApp }>("runtime").run(message.id, message.revisionId, message.tabId, false, message.clientId);
    case "stop": {
      const run = db.runs.find(item => item.id === message.runId);
      if (run) { await stopApp(run.appId, run.tabId); await logRun(run.id, "info", "已结束运行", "stopped"); broadcast({ type: "stopPanel", runId: run.id }); }
      return true;
    }
    case "panelEvent": {
      const run = db.runs.find(item => item.id === message.runId);
      if (!run || run.status === "stopped") return false;
      await logRun(run.id, message.level ?? "info", String(message.text ?? ""), message.status);
      if (message.status === "stopped" || message.status === "failed") panelOwners.delete(run.id);
      return true;
    }
    case "panelStorage": {
      const run = db.runs.find(item => item.id === message.runId);
      if (!run || run.tabId !== undefined || ["stopped", "unknown", "failed"].includes(run.status)) throw new Error("界面实例已失效");
      const key = `app:${run.appId}:${String(message.key).slice(0, 200)}`;
      if (message.method === "set") await chrome.storage.local.set({ [key]: message.value });
      else if (message.method !== "get") throw new Error("无效存储操作");
      return (await chrome.storage.local.get(key))[key] ?? null;
    }
    case "panelCapability": {
      const run = db.runs.find(item => item.id === message.runId);
      if (!run || run.tabId !== undefined || ["stopped", "unknown", "failed"].includes(run.status)) throw new Error("界面实例已失效");
      return capability(run.appId, message.capability, message.args);
    }
    case "connect": return nativeRpc("status");
    case "models": return nativeRpc("models");
    case "cancel": return nativeRpc("cancel");
    case "chat": {
      const text = String(message.text ?? "").trim();
      if (!text || text.length > 50_000) throw new Error("消息为空或过长");
      activeClientId = message.clientId;
      await mutate(database => { database.chat.push({ id: crypto.randomUUID(), role: "user", text, time: Date.now() }); });
      const context = buildAgentContext(db, message.context ?? {}, await targetTabs());
      return plugins.get<{ request: typeof nativeRpc }>("agent").request("chat", { text, threadId: db.threadId, model: message.model, context });
    }
    case "newChat": await nativeRpc("reset"); await mutate(database => { database.chat = []; database.threadId = undefined; }); return true;
    case "pageReady": if (sender?.tab?.id !== undefined) await reconcileTab(sender.tab.id, message.url); return true;
    case "openPanel": if (sender?.tab?.id !== undefined) await chrome.sidePanel.open({ tabId: sender.tab.id }); return true;
    default: throw new Error("未知操作");
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel !== "bee:request") return;
  if (message.type === "openPanel" && sender.tab?.id !== undefined) {
    void chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => reply({ ok: true, data: true }), error => reply({ ok: false, error: String(error) }));
    return true;
  }
  void handle(message, sender).then(data => reply({ ok: true, data }), error => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
chrome.runtime.onConnect.addListener(connection => {
  if (!connection.name.startsWith("bee:ui:")) return;
  const url = connection.sender?.url;
  if (!url || ![chrome.runtime.getURL("index.html"), chrome.runtime.getURL("sidepanel.html")].some(page => url.split(/[?#]/)[0] === page)) { connection.disconnect(); return; }
  const clientId = connection.name.slice("bee:ui:".length);
  uiClients.add(clientId);
  connection.onDisconnect.addListener(() => {
    uiClients.delete(clientId);
    void (async () => {
      await storeReady;
      for (const [runId, owner] of panelOwners) if (owner === clientId) {
        panelOwners.delete(runId);
        await logRun(runId, "info", "工作台已关闭，界面实例已结束", "stopped");
      }
      for (const active of [...activeRuns.values()]) if (active.clientId === clientId && !db.entries.find(entry => entry.id === active.appId)?.installed) await stopApp(active.appId, active.tabId);
    })();
  });
});
chrome.runtime.onUserScriptMessage.addListener((message, sender, reply) => {
  if (message?.channel !== "bee:script") return;
  const active = [...activeRuns.values()].find(run => run.runId === message.runId && run.tabId === sender.tab?.id && (!run.documentId || run.documentId === sender.documentId));
  if (!active) { reply({ error: "页面实例已失效" }); return; }
  void (async () => {
    const data = message.data ?? {};
    if (["storageGet", "storageSet", "tabsList", "tabsOpen", "tabsInspect", "tabsAction"].includes(message.type)) return capability(active.appId, message.type, data);
    if (message.type === "complete") await logRun(active.runId, "result", data.result ?? "执行完成", data.resources ? "active" : "succeeded");
    else if (message.type === "error") await logRun(active.runId, "error", data.text, "failed");
    else await logRun(active.runId, data.level ?? message.type ?? "info", String(data.text ?? ""));
    return true;
  })().then(reply, error => reply({ error: String(error) }));
  return true;
});
chrome.webNavigation.onHistoryStateUpdated.addListener(details => { if (details.frameId === 0) void reconcileTab(details.tabId, details.url); });
chrome.tabs.onRemoved.addListener(tabId => { for (const [key, active] of activeRuns) if (active.tabId === tabId) { activeRuns.delete(key); void logRun(active.runId, "info", "目标标签页已关闭", "stopped"); } });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
