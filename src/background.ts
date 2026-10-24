import { pageActivity, type PageActivity } from "./core/page-activity";
import type { SetupSnapshot } from "./core/onboarding";
import { createPluginHost } from "./core/plugins";
import { applyOperation, current, findEntry, importPackage, matchesUrl, validateDefinition, type Database, type Operation, type Run } from "./core/model";
import { createInitialDatabase } from "./core/samples";
import { HOST_NAME, type ConnectorStatus, type NativeMessage } from "./core/protocol";
import { pageProgram, stopProgram } from "./runtime";
import { browserAction, inspectPage } from "./browser-tools";
import capabilities from "../shared/capabilities.json";
import { buildAgentContext, getRun, listRuns } from "./core/agent-context";
import { requireSession, migrateSessions, syncChatProjection, applySessionEvent } from "./core/sessions";
import { importUserscript, searchUserscripts, type ScriptSort, type ScriptSource } from "./core/script-sources";
import { AgentSessionService } from "./agents/session-service";

let db: Database;
let activityFingerprint = "";
let transaction: Promise<unknown> = Promise.resolve();
let port: chrome.runtime.Port | undefined;
let connector: ConnectorStatus = { connected: false };
const uiClients = new Set<string>();
const panelOwners = new Map<string, string>();
const pendingDeltas = new Map<string, Record<string, any>>();
let deltaTimer: ReturnType<typeof setTimeout> | undefined;
const nativePending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
const activeRuns = new Map<string, { appId: string; runId: string; tabId: number; url: string; revisionId: string; documentId?: string; clientId?: string }>();
const storeReady = chrome.storage.local.get("database").then(async ({ database }) => {
  db = migrateSessions((database as Database | undefined) ?? createInitialDatabase(), true);
  for (const run of db.runs) if (run.status === "running" || run.status === "active") run.status = "unknown";
  await chrome.storage.local.set({ database: db });
});
function broadcast(event: unknown) { void chrome.runtime.sendMessage({ channel: "bee:event", event }).catch(() => {}); }
async function mutate<T>(callback: (database: Database) => T): Promise<T> {
  const next = transaction.catch(() => {}).then(async () => {
    await storeReady;
    const updated = structuredClone(db);
    const result = callback(updated);
    syncChatProjection(updated);
    await chrome.storage.local.set({ database: updated });
    db = updated;
    const fingerprint = JSON.stringify([db.entries.map(entry => [entry.id, entry.installed, entry.enabled, entry.revisionId]), db.runs.map(run => [run.id, run.status, run.documentId])]);
    const activityChanged = fingerprint !== activityFingerprint;
    activityFingerprint = fingerprint;
    broadcast({ type: "database", activityChanged });
    if (activityChanged) scheduleBadges();
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
    for (const [, event] of batch) applySessionEvent(database, event);
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
async function getPageActivity(tabId?: number): Promise<PageActivity> {
  await storeReady;
  let scriptsAvailable = false;
  try { await availableScripts(); scriptsAvailable = true; } catch {}
  const unavailable = { available: false, scriptsAvailable, items: [] };
  if (!Number.isInteger(tabId)) return unavailable;
  try {
    const tab = await chrome.tabs.get(tabId!);
    const frame = await chrome.webNavigation.getFrame({ tabId: tabId!, frameId: 0 });
    if (!tab.url || !/^https?:/.test(tab.url) || !frame?.documentId || frame.url !== tab.url) return unavailable;
    return { available: true, scriptsAvailable, tabId, title: tab.title, url: tab.url, documentId: frame.documentId,
      items: pageActivity(db, { tabId: tabId!, url: tab.url, documentId: frame.documentId }, [...activeRuns.values()], scriptsAvailable) };
  } catch { return unavailable; }
}
let badgeTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBadges() {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = undefined;
    void (async () => {
      for (const tab of await targetTabs()) {
        const activity = await getPageActivity(tab.id);
        const count = activity.items.filter(item => item.state === "active" || item.state === "running").length;
        await chrome.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : "" });
        await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b8790a" });
      }
    })().catch(() => {});
  }, 200);
}
async function setupSnapshot(): Promise<SetupSnapshot> {
  let scripts = false;
  try { await availableScripts(); scripts = true; } catch {}
  const { setupCompleted } = await chrome.storage.local.get("setupCompleted");
  const base = { extension: true, version: chrome.runtime.getManifest().version, scripts, completed: setupCompleted === true };
  try {
    const result = await nativeRpc("diagnostics") as { version: string; providers: SetupSnapshot["providers"] };
    return { ...base, connector: true, connectorVersion: result.version, providers: result.providers };
  } catch { return { ...base, connector: false, providers: [], issue: "host-unavailable" }; }
}
async function stopApp(appId: string, tabId?: number) {
  for (const [key, active] of [...activeRuns]) {
    if (active.appId !== appId || (tabId !== undefined && active.tabId !== tabId)) continue;
    try { await chrome.userScripts.execute({ target: { tabId: active.tabId, ...(active.documentId ? { documentIds: [active.documentId] } : {}) }, js: [{ code: stopProgram(appId) }] }); } catch { /* 页面可能已关闭或导航。 */ }
    activeRuns.delete(key);
    await logRun(active.runId, "info", "已结束页面实例；外部业务操作不会回滚", "stopped");
  }
}
async function runApp(appId: string, revisionId: string, tabId?: number, automatic = false, clientId?: string) {
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
    await mutate(database => { const record = database.runs.find(item => item.id === run.id); if (record) record.documentId = frame.documentId; });
    await chrome.userScripts.configureWorld({ messaging: true });
    const results = await chrome.userScripts.execute({ target: { tabId: tabId!, documentIds: [frame.documentId] }, js: [{ code: pageProgram({ appId, runId: run.id, definition }) }] });
    active.documentId = results[0]?.documentId ?? frame.documentId;
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
  if (type === "appsList") return db.entries.map(entry => {
    const definition = current(entry).definition;
    return { id: entry.id, title: definition.title, description: definition.description, kind: definition.kind, installed: entry.installed, enabled: entry.enabled, favorite: entry.favorite, revisionId: entry.revisionId, revisionCount: entry.revisions.length };
  });
  if (type === "appsRun") {
    const entry = findEntry(db, String(data.id ?? ""));
    if (entry.id === appId) throw new Error("微应用不能运行自身；请直接使用当前实例");
    const tabId = data.tabId === undefined || data.tabId === null ? undefined : Number(data.tabId);
    if (current(entry).definition.kind === "page" && (tabId === undefined || !Number.isInteger(tabId))) throw new Error("页面脚本需要指定目标标签页 tabId");
    return runApp(entry.id, entry.revisionId, current(entry).definition.kind === "page" ? tabId : undefined, false);
  }
  if (type === "appsUpdate") {
    const entry = findEntry(db, String(data.id ?? ""));
    if (typeof data.favorite === "boolean") await handle({ type: "operation", operation: { type: "favorite", id: entry.id, value: data.favorite } });
    if (typeof data.enabled === "boolean" && entry.installed) await handle({ type: "operation", operation: { type: "enable", id: entry.id, value: data.enabled } });
    return { id: entry.id, favorite: data.favorite, enabled: data.enabled };
  }
  if (type === "agentAsk") return askAgent(appId, data);
  throw new Error("未知微应用能力");
}

/** 微应用主动呼叫 AI：把需求投递到当前会话，并带上自己作为引用，让 AI 能直接改它。 */
async function askAgent(appId: string, data: any) {
  const text = String(data?.prompt ?? "").trim().slice(0, 4000);
  if (!text) throw new Error("请说明想让 AI 做什么");
  if (!port) throw new Error("请先在 BeeHelper 侧边栏连接 AI 客户端（Codex / Claude Code / DSH），再让微应用呼叫 AI");
  const session = requireSession(db);
  if (session.archived) throw new Error("当前会话已归档，请先恢复归档会话");
  const entry = findEntry(db, appId);
  const revision = current(entry);
  const clientId = session.executionClientId ?? uiClients.values().next().value;
  await agentSessions.handle({
    type: "chat", sessionId: session.id, text, mode: "queue", clientId,
    references: [{ kind: "microapp", id: entry.id, label: revision.definition.title, revisionId: revision.id }],
    context: { selectedAppId: entry.id, revisionId: revision.id, source: "microapp" }
  });
  return { sessionId: session.id, queued: true, title: revision.definition.title };
}
async function invokeTool(name: string, args: any, scope?: { sessionId?: string; connectionId?: string }): Promise<unknown> {
  await storeReady;
  await transaction.catch(() => {});
  const session = requireSession(db, scope?.sessionId);
  if (!scope?.connectionId || session.archived || session.connectionId !== scope.connectionId || ["disconnected", "unknown"].includes(session.state)) throw new Error("工具所属会话连接已失效");
  const source = session.providerId === "codex" ? "Codex" : session.providerId;
  if (name === "capabilities_get") {
    let userScriptsAvailable = true;
    try { await availableScripts(); } catch { userScriptsAvailable = false; }
    return { ...capabilities, userScriptsAvailable, userscripts: { sources: ["scriptcat", "greasyfork"], tools: ["userscript_search", "userscript_import"], note: "网络可达性取决于用户环境；ScriptCat 在国内通常可直连，GreasyFork 可能被阻断" } };
  }
  if (name === "microapp_list") return db.entries.map(entry => ({ id: entry.id, installed: entry.installed, revisionId: entry.revisionId, ...current(entry).definition }));
  if (name === "microapp_get") return findEntry(db, args.id);
  if (name === "microapp_create") return (await mutate(database => {
    const result = applyOperation(database, { type: "create", definition: validateDefinition(args.definition), source }); Object.assign(database, result.db); return result.entry;
  }));
  if (name === "microapp_update") return (await mutate(database => {
    const result = applyOperation(database, { type: "edit", id: args.id, expectedRevision: args.expectedRevision, definition: validateDefinition(args.definition), source }); Object.assign(database, result.db); return result.entry;
  }));
  if (name === "microapp_run") return runApp(args.id, args.revisionId, args.tabId, false, session.executionClientId);
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
  if (name === "userscript_search") {
    const source: ScriptSource = args.source === "greasyfork" ? "greasyfork" : "scriptcat";
    const sort: ScriptSort = ["popular", "trending", "recent", "score"].includes(args.sort) ? args.sort : "popular";
    const result = await searchUserscripts(source, { query: args.query, sort, limit: args.limit });
    return { source: result.source, cached: Boolean(result.cached), items: result.items.map(item => ({
      source: item.source, id: item.id, name: item.name, description: item.description.slice(0, 240),
      author: item.author, version: item.version, totalInstalls: item.totalInstalls, dailyInstalls: item.dailyInstalls,
      score: item.score, pageUrl: item.pageUrl, tags: item.tags
    })) };
  }
  if (name === "userscript_import") {
    const source: ScriptSource = args.source === "greasyfork" ? "greasyfork" : "scriptcat";
    const converted = await importUserscript(source, String(args.id ?? ""));
    const entry = await mutate(database => {
      const created = applyOperation(database, { type: "create", definition: converted.definition, source: `${source === "scriptcat" ? "ScriptCat" : "GreasyFork"} 导入` });
      Object.assign(database, created.db);
      return created.entry!;
    });
    return {
      id: entry.id, revisionId: entry.revisionId, installed: false,
      title: converted.definition.title, kind: converted.definition.kind, matches: converted.definition.matches, trigger: converted.definition.trigger,
      notes: converted.notes, requires: converted.requires, grants: converted.grants,
      message: "已导入为未安装候选；默认手动运行。用 microapp_get 读取源码，确认后在用户要求时安装。"
    };
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
    flushDeltas();
    void mutate(database => { Object.assign(database, migrateSessions(database, true)); });
    broadcast({ type: "connector", status: connector });
  });
  port.onMessage.addListener((message: NativeMessage) => {
    if (message.kind === "reply" && message.id) {
      const pending = nativePending.get(message.id);
      if (pending) { clearTimeout(pending.timeout); nativePending.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
    } else if (message.kind === "tool") {
      const sourcePort = port;
      void invokeTool(message.name!, message.args, message).then(result => sourcePort?.postMessage({ kind: "toolResult", id: message.id, result }), error => sourcePort?.postMessage({ kind: "toolResult", id: message.id, error: String(error) })).catch(() => {});
    } else if (message.kind === "event" && message.event) {
      const event = message.event;
      if (event.type === "delta" && typeof event.text === "string") {
        const id = `${event.sessionId}:${event.connectionId}:${event.messageId}`;
        pendingDeltas.set(id, { ...event, text: (pendingDeltas.get(id)?.text ?? "") + event.text });
        deltaTimer ??= setTimeout(flushDeltas, 80);
        return;
      }
      flushDeltas();
      void agentSessions.receive(event).then(applied => {
        if (!applied) return;
        broadcast(event);
      });
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
const agentSessions = new AgentSessionService({
  read: () => db, mutate, request: nativeRpc, connected: () => Boolean(port),
  clientAlive: id => uiClients.has(id),
  context: async selection => buildAgentContext(db, selection, await targetTabs()),
  references: async references => {
    const tabs = await targetTabs();
    return references.map(reference => {
      if (reference.kind === "microapp") {
        const entry = findEntry(db, reference.id), revision = current(entry);
        return { kind: reference.kind, id: entry.id, label: revision.definition.title, revisionId: revision.id };
      }
      if (reference.kind === "page") {
        const tab = tabs.find(tab => String(tab.id) === reference.id);
        if (!tab) throw new Error("引用页面已关闭或不可访问，请重新选择");
        return { kind: reference.kind, id: String(tab.id), label: tab.title, url: tab.url };
      }
      return reference;
    });
  }
});
const plugins = createPluginHost([
  { name: "local-library", services: { store: { mutate } } },
  { name: "page-runtime", services: { runtime: { run: runApp, stop: stopApp, activity: getPageActivity } } },
  { name: "system-setup", services: { setup: { snapshot: setupSnapshot } } },
  { name: "agent-sessions", services: { agent: agentSessions } }
]);

async function handle(message: any, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  await storeReady;
  if (agentSessions.accepts(message.type)) return plugins.get<AgentSessionService>("agent").handle(message);
  switch (message.type) {
    case "setupSnapshot": case "setupComplete": case "setupStatus": case "openExtensionDetails": case "openInstallGuide": case "pageActivity": {
      const url = sender?.url?.split(/[?#]/)[0];
      if (!url || ![chrome.runtime.getURL("index.html"), chrome.runtime.getURL("sidepanel.html")].includes(url)) throw new Error("此能力仅对 BeeHelper 工作台开放");
      if (message.type === "setupSnapshot") {
        const snapshot = await plugins.get<{ snapshot: typeof setupSnapshot }>("setup").snapshot();
        broadcast({ type: "targets" }); scheduleBadges(); return snapshot;
      }
      if (message.type === "setupStatus") return { completed: (await chrome.storage.local.get("setupCompleted")).setupCompleted === true };
      if (message.type === "setupComplete") { await chrome.storage.local.set({ setupCompleted: true }); broadcast({ type: "setup" }); return true; }
      if (message.type === "pageActivity") return plugins.get<{ activity: typeof getPageActivity }>("runtime").activity(message.tabId);
      await chrome.tabs.create({ url: message.type === "openExtensionDetails" ? `chrome://extensions/?id=${chrome.runtime.id}` : "https://github.com/Real-CyberBee/BeeHelper/blob/main/docs/getting-started.md" });
      return true;
    }
    case "state": await transaction.catch(() => {}); return { db, connector: agentSessions.status(connector) };
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
    case "userscriptSearch": {
      const source: ScriptSource = message.source === "greasyfork" ? "greasyfork" : "scriptcat";
      const sort: ScriptSort = ["popular", "trending", "recent", "score"].includes(message.sort) ? message.sort : "popular";
      return searchUserscripts(source, { query: message.query, sort, limit: message.limit });
    }
    case "userscriptImport": {
      const source: ScriptSource = message.source === "greasyfork" ? "greasyfork" : "scriptcat";
      const converted = await importUserscript(source, String(message.id ?? ""));
      const entry = await mutate(database => {
        const created = applyOperation(database, { type: "create", definition: converted.definition, source: `${source === "scriptcat" ? "ScriptCat" : "GreasyFork"} 导入` });
        Object.assign(database, created.db);
        return created.entry!;
      });
      return { entry, notes: converted.notes, requires: converted.requires, grants: converted.grants, author: converted.hit?.author, version: converted.hit?.version, pageUrl: converted.hit?.pageUrl };
    }
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
    void agentSessions.releaseClient(clientId);
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
    if (["storageGet", "storageSet", "tabsList", "tabsOpen", "tabsInspect", "tabsAction", "appsList", "appsRun", "appsUpdate", "agentAsk"].includes(message.type)) {
      if (["agentAsk", "appsRun", "appsUpdate"].includes(message.type)) await logRun(active.runId, "info", `微应用调用的宿主能力：${message.type}`);
      return capability(active.appId, message.type, data);
    }
    if (message.type === "complete") await logRun(active.runId, "result", data.result ?? "执行完成", data.resources ? "active" : "succeeded");
    else if (message.type === "error") await logRun(active.runId, "error", data.text, "failed");
    else await logRun(active.runId, data.level ?? message.type ?? "info", String(data.text ?? ""));
    return true;
  })().then(reply, error => reply({ error: String(error) }));
  return true;
});
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  void chrome.action.setBadgeText({ tabId: details.tabId, text: "" }).catch(() => {});
  void (async () => {
    await storeReady;
    for (const [key, active] of [...activeRuns]) if (active.tabId === details.tabId && active.documentId !== details.documentId) {
      activeRuns.delete(key); await logRun(active.runId, "info", "目标文档已导航，旧实例已结束", "stopped");
    }
    broadcast({ type: "targets" }); scheduleBadges();
  })();
});
chrome.tabs.onActivated.addListener(() => { broadcast({ type: "targets" }); scheduleBadges(); });
chrome.tabs.onUpdated.addListener((_tabId, change) => { if (change.url || change.status === "complete") { broadcast({ type: "targets" }); scheduleBadges(); } });
chrome.webNavigation.onHistoryStateUpdated.addListener(details => { if (details.frameId === 0) void reconcileTab(details.tabId, details.url); });
chrome.tabs.onRemoved.addListener(tabId => { broadcast({ type: "targets" }); for (const [key, active] of activeRuns) if (active.tabId === tabId) { activeRuns.delete(key); void logRun(active.runId, "info", "目标标签页已关闭", "stopped"); } });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

void storeReady.then(scheduleBadges);
