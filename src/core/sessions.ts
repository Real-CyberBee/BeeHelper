import type { ChatMessage, Database } from "./model";
import type { ChatAttachment, ChatReference, ChatDraft, AgentCommand, AgentSkill, AgentConfigOption } from "./chat-content";

export type SessionState = "idle" | "connecting" | "running" | "stopping" | "disconnected" | "unknown";
export type DeliveryMode = "queue" | "steer";
export interface AgentModel { id: string; name: string; inputModalities?: string[]; reasoningEfforts?: string[]; defaultEffort?: string }
export interface AgentCapabilities { models: boolean; steer: boolean; resume: boolean; tools: boolean; images?: boolean; files?: boolean; commands?: boolean; skills?: boolean; config?: boolean }
export interface AgentProvider { id: string; name: string; available: boolean; installed?: boolean; reason?: string; protocol: string }
export interface ChatQueueItem { id: string; text: string; context: unknown; clientId?: string; time: number; attachments?: ChatAttachment[]; references?: ChatReference[]; command?: string }
export interface AgentPermission { id: string; title: string; options: { id: string; name: string }[] }
export interface ChatSession {
  id: string; providerId: string; title: string; createdAt: number; updatedAt: number;
  messages: ChatMessage[]; state: SessionState; queue: ChatQueueItem[]; queuePaused: boolean;
  nativeSessionId?: string; connectionId?: string; turnId?: string; error?: string;
  model?: string; appliedModel?: string; models: AgentModel[]; capabilities: AgentCapabilities;
  archived?: boolean; permission?: AgentPermission; permissions?: AgentPermission[];
  executionClientId?: string; version?: string; authenticated?: boolean;
  draft?: ChatDraft; commands?: AgentCommand[]; skills?: AgentSkill[];
  draftUpdatedAt?: number;
  metadataVersion?: number;
  configOptions?: AgentConfigOption[]; nextConfig?: Record<string, string | boolean>;
}
export const emptyAgentCapabilities = (): AgentCapabilities => ({ models: false, steer: false, resume: false, tools: false });
export const sessionBusy = (session?: ChatSession) => Boolean(session && ["running", "connecting", "stopping"].includes(session.state));
export function createSession(providerId = "codex"): ChatSession {
  const now = Date.now();
  return { id: crypto.randomUUID(), providerId, title: "新的对话", createdAt: now, updatedAt: now, messages: [], state: "disconnected", queue: [], queuePaused: false, models: [], capabilities: emptyAgentCapabilities() };
}
export function activeSession(db: Database): ChatSession | undefined {
  return db.sessions?.find(session => session.id === db.activeSessionId);
}
export function requireSession(db: Database, id?: string): ChatSession {
  const session = db.sessions?.find(item => item.id === (id ?? db.activeSessionId));
  if (!session) throw new Error("会话不存在，请重新选择");
  return session;
}
// chat/threadId 仅作为旧界面与旧测试的兼容投影；会话数组是唯一数据源。
export function syncChatProjection(db: Database) {
  const selected = activeSession(db);
  db.chat = selected?.messages ?? [];
  db.threadId = selected?.nativeSessionId;
}
export function migrateSessions(database: Database, disconnected = false): Database {
  const db = structuredClone(database);
  if (!db.sessions) {
    const session = createSession();
    session.messages = db.chat ?? [];
    session.nativeSessionId = db.threadId;
    session.title = session.messages.find(message => message.role === "user")?.text.slice(0, 60) || "新的对话";
    db.sessions = [session]; db.activeSessionId = session.id;
  }
  if (!activeSession(db)) db.activeSessionId = db.sessions.find(session => !session.archived)?.id ?? db.sessions[0]?.id;
  if (disconnected) for (const session of db.sessions) {
    const interrupted = sessionBusy(session) || session.state === "unknown";
    session.state = interrupted ? "unknown" : "disconnected";
    session.queuePaused = session.queuePaused || interrupted || session.queue.length > 0;
    for (const message of session.messages) if (message.delivery === "sending") message.delivery = "unknown";
    delete session.connectionId; delete session.turnId; delete session.permission; delete session.permissions;
  }
  db.version = 2; syncChatProjection(db);
  return db;
}
export function selectSession(db: Database, id: string) {
  const session = requireSession(db, id);
  if (session.archived) throw new Error("请先恢复归档会话");
  db.activeSessionId = id; syncChatProjection(db);
}
export function addUserMessage(session: ChatSession, item: ChatQueueItem, queued: boolean) {
  if (session.messages.some(message => message.id === item.id)) throw new Error("消息已存在，不能重复发送");
  session.messages.push({ id: item.id, role: "user", text: item.text, time: item.time, delivery: queued ? "queued" : "sending", attachments: item.attachments, references: item.references });
  if (session.title === "新的对话") session.title = item.text.slice(0, 60) || item.attachments?.[0]?.name || "附件对话";
  session.updatedAt = Date.now();
  if (queued) session.queue.push(item);
}
export function removeQueuedMessage(session: ChatSession, id: string) {
  if (!session.queue.some(item => item.id === id)) throw new Error("消息已开始投递，不能从队列删除");
  session.queue = session.queue.filter(item => item.id !== id);
  session.messages = session.messages.filter(item => item.id !== id);
}
export function applySessionEvent(db: Database, event: Record<string, any>): boolean {
  const session = db.sessions?.find(item => item.id === event.sessionId);
  if (!session) return false;
  if (event.connectionId && event.connectionId !== session.connectionId) return false;
  if (event.type === "delta" && typeof event.text === "string") {
    const id = String(event.messageId);
    const message = session.messages.find(item => item.id === id);
    if (message) message.text += event.text;
    else session.messages.push({ id, role: "assistant", text: event.text, time: Date.now() });
  } else if (event.type === "tool" || event.type === "error") {
    const existing = event.toolCallId ? session.messages.find(message => message.tool?.id === event.toolCallId) : undefined;
    if (existing) { existing.text = String(event.message); existing.tool = { id: event.toolCallId, title: event.title ?? existing.tool?.title ?? "", status: event.status ?? existing.tool?.status ?? "更新" }; }
    else session.messages.push({ id: crypto.randomUUID(), role: event.type, text: String(event.message), time: Date.now(), ...(event.toolCallId ? { tool: { id: event.toolCallId, title: event.title ?? event.message, status: event.status ?? "更新" } } : {}) });
    if (event.type === "error") session.error = String(event.message);
  } else if (event.type === "session") {
    if (typeof event.metadataVersion === "number") {
      if (event.metadataVersion < (session.metadataVersion ?? 0)) return false;
      session.metadataVersion = event.metadataVersion;
    }
    if (event.nativeSessionId) session.nativeSessionId = event.nativeSessionId;
    if (event.capabilities) session.capabilities = { ...emptyAgentCapabilities(), ...event.capabilities };
    if (event.models) session.models = event.models;
    if (event.appliedModel !== undefined) {
      session.appliedModel = event.appliedModel;
      if (session.model === session.appliedModel) delete session.model;
    }
    if (event.commands) session.commands = event.commands;
    if (event.skills) session.skills = event.skills;
    if (event.configOptions) {
      session.configOptions = event.configOptions;
      for (const option of session.configOptions ?? []) if (session.nextConfig?.[option.id] === option.currentValue) delete session.nextConfig[option.id];
    }
    if (event.version !== undefined) session.version = event.version;
    if (event.authenticated !== undefined) session.authenticated = event.authenticated;
  } else if (event.type === "state") {
    session.state = event.state;
    session.turnId = event.turnId;
    if (event.state === "unknown") {
      session.queuePaused = true;
      for (const message of session.messages) if (message.delivery === "sending") message.delivery = "unknown";
      delete session.permission; delete session.permissions;
    }
  } else if (event.type === "delivery") {
    const message = session.messages.find(item => item.id === event.messageId);
    if (message) message.delivery = event.status;
  } else if (event.type === "permission") {
    const pending = session.permissions ?? (session.permission ? [session.permission] : []);
    session.permissions = event.permission
      ? [...pending.filter(item => item.id !== event.permission.id), event.permission]
      : event.requestId ? pending.filter(item => item.id !== event.requestId) : [];
    session.permission = session.permissions[0];
  } else if (event.type === "done") {
    session.state = "idle"; delete session.turnId; delete session.permission; delete session.permissions;
    if (event.status !== "completed") session.queuePaused = true;
  }
  session.updatedAt = Date.now(); syncChatProjection(db);
  return true;
}
