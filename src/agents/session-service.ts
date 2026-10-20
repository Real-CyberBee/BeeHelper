import type { Database } from "../core/model";
import type { ConnectorStatus } from "../core/protocol";
import { activeSession, requireSession, syncChatProjection, selectSession, createSession, sessionBusy, addUserMessage, removeQueuedMessage, applySessionEvent, type ChatQueueItem, type ChatSession } from "../core/sessions";
import { validateDraft, commandToken, type ChatReference } from "../core/chat-content";

interface Dependencies {
  read: () => Database;
  mutate: <T>(callback: (database: Database) => T) => Promise<T>;
  request: (method: string, params?: unknown) => Promise<any>;
  connected: () => boolean;
  context: (selection: Record<string, unknown>) => Promise<unknown>;
  references?: (references: ChatReference[]) => Promise<ChatReference[]>;
  clientAlive?: (id: string) => boolean;
}
const methods = new Set(["providers", "sessionNew", "newChat", "sessionSelect", "sessionRename", "sessionArchive", "connect", "models", "sessionModel", "sessionConfig", "sessionDraft", "sessionCatalog", "cancel", "sessionPermission", "queueRemove", "queueResume", "chat", "attachmentBegin", "attachmentChunk", "attachmentFinish", "attachmentRead", "attachmentAbort"]);

export class AgentSessionService {
  private locks = new Map<string, Promise<unknown>>();
  private connections = new Map<string, Promise<ChatSession>>();
  private uploads = new Map<string, { sessionId: string; clientId: string }>();
  constructor(private deps: Dependencies) {}
  private get db() { return this.deps.read(); }
  accepts(type: string) { return methods.has(type); }
  async releaseClient(clientId: string) {
    for (const [id, owner] of this.uploads) if (owner.clientId === clientId) {
      this.uploads.delete(id);
      await this.deps.request("attachmentAbort", { id, sessionId: owner.sessionId }).catch(() => {});
    }
  }
  status(connector: ConnectorStatus): ConnectorStatus {
    const session = activeSession(this.db);
    return { ...connector, ready: Boolean(connector.connected && session?.connectionId && !["disconnected", "unknown", "connecting"].includes(session.state)), busy: sessionBusy(session), version: session?.version, authenticated: session?.authenticated };
  }
  async receive(event: Record<string, any>) {
    const applied = await this.deps.mutate(database => applySessionEvent(database, event));
    if (applied && event.type === "done" && event.status === "completed") void this.drain(String(event.sessionId));
    return applied;
  }
  private lock<T>(id: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(callback);
    this.locks.set(id, next);
    void next.finally(() => { if (this.locks.get(id) === next) this.locks.delete(id); }).catch(() => {});
    return next;
  }
  private async ensure(id: string): Promise<ChatSession> {
    if (this.connections.has(id)) return this.connections.get(id)!;
    const task = (async () => {
      const selected = requireSession(this.db, id);
      if (this.deps.connected() && selected.connectionId && !["disconnected", "unknown", "connecting"].includes(selected.state)) return selected;
      const connectionId = crypto.randomUUID();
      await this.deps.mutate(database => { const session = requireSession(database, id); session.connectionId = connectionId; session.metadataVersion = 0; session.state = "connecting"; session.error = undefined; });
      try {
        const session = requireSession(this.db, id);
        const result = await this.deps.request("connect", { sessionId: id, connectionId, providerId: session.providerId, nativeSessionId: session.nativeSessionId });
        await this.deps.mutate(database => {
          applySessionEvent(database, { type: "session", sessionId: id, connectionId, ...result });
          const session = requireSession(database, id); if (session.connectionId === connectionId && session.state === "connecting") session.state = "idle";
        });
        return requireSession(this.db, id);
      } catch (error) {
        await this.deps.mutate(database => {
          const session = requireSession(database, id);
          if (session.connectionId === connectionId) { session.state = "disconnected"; session.error = String(error); }
        });
        throw error;
      }
    })();
    this.connections.set(id, task);
    try { return await task; } finally { this.connections.delete(id); }
  }
  private async dispatch(id: string, item: ChatQueueItem, mode = "queue") {
    const session = requireSession(this.db, id);
    await this.deps.mutate(database => {
      const selected = requireSession(database, id);
      selected.error = undefined;
      if (mode !== "steer") { selected.executionClientId = item.clientId; selected.state = "running"; }
      const message = selected.messages.find(message => message.id === item.id);
      if (message) message.delivery = "sending";
    });
    try {
      return await this.deps.request("send", { sessionId: id, connectionId: session.connectionId, messageId: item.id, text: item.text, context: item.context, mode, model: session.model, config: session.nextConfig, attachments: item.attachments?.map(item => ({ id: item.id })), references: item.references, command: item.command });
    } catch (error) {
      await this.deps.mutate(database => {
        const selected = requireSession(database, id);
        const message = selected.messages.find(message => message.id === item.id);
        const unknown = /超时|断开|关闭|退出|进程|连接.*失效/.test(String(error));
        if (message) message.delivery = unknown ? "unknown" : "failed";
        if (mode !== "steer") selected.state = unknown ? "unknown" : "idle";
        selected.queuePaused = true; selected.error = String(error);
      });
      throw error;
    }
  }
  private async drain(id: string) {
    await this.lock(id, async () => {
      const selected = requireSession(this.db, id);
      if (selected.state !== "idle" || selected.queuePaused || !selected.queue.length) return;
      const item = await this.deps.mutate(database => {
        const session = requireSession(database, id); session.state = "running";
        return session.queue.shift()!;
      });
      await this.dispatch(id, item);
    }).catch(() => {});
  }
  async handle(message: Record<string, any>): Promise<any> {
    if (message.type.startsWith("attachment")) {
      const session = requireSession(this.db, message.sessionId);
      if (session.archived) throw new Error("请先恢复归档会话");
      if (message.type === "attachmentBegin" && message.clientId && this.deps.clientAlive && !this.deps.clientAlive(message.clientId)) throw new Error("工作台已关闭，不能启动上传");
      const result = await this.deps.request(message.type, { sessionId: session.id, id: message.id, name: message.name, mime: message.mime, size: message.size, offset: message.offset, data: message.data });
      if (message.type === "attachmentBegin" && result.id && message.clientId) {
        if (this.deps.clientAlive && !this.deps.clientAlive(message.clientId)) {
          await this.deps.request("attachmentAbort", { id: result.id, sessionId: session.id }).catch(() => {});
          throw new Error("工作台已关闭，上传已取消");
        }
        this.uploads.set(result.id, { sessionId: session.id, clientId: message.clientId });
      }
      if (message.type === "attachmentFinish" || message.type === "attachmentAbort") this.uploads.delete(message.id);
      return result;
    }
    switch (message.type) {
      case "providers": return this.deps.request("providers");
      case "sessionNew":
      case "newChat": {
        const session = createSession(message.providerId ?? activeSession(this.db)?.providerId ?? "codex");
        await this.deps.mutate(database => { database.sessions!.unshift(session); selectSession(database, session.id); });
        return session;
      }
      case "sessionSelect": await this.deps.mutate(database => selectSession(database, message.sessionId)); return true;
      case "sessionRename": {
        const title = String(message.title ?? "").trim();
        if (!title || title.length > 100) throw new Error("会话名称应为 1 至 100 字");
        await this.deps.mutate(database => { requireSession(database, message.sessionId).title = title; }); return true;
      }
      case "sessionArchive": {
        const selected = requireSession(this.db, message.sessionId);
        await this.deps.mutate(database => {
          const session = requireSession(database, message.sessionId);
          if (sessionBusy(session) || session.queue.length) throw new Error("请先停止任务并清空队列");
          session.archived = Boolean(message.archived);
          if (session.archived && database.activeSessionId === session.id) {
            const other = database.sessions!.find(item => !item.archived);
            if (other) database.activeSessionId = other.id;
            else { const next = createSession(session.providerId); database.sessions!.unshift(next); database.activeSessionId = next.id; }
          }
        });
        if (message.archived && selected.connectionId) {
          await this.deps.request("disconnect", { sessionId: selected.id, connectionId: selected.connectionId }).catch(() => {});
          await this.deps.mutate(database => { const session = requireSession(database, selected.id); session.state = "disconnected"; delete session.connectionId; });
        }
        return true;
      }
      case "connect": {
        const session = await this.ensure(requireSession(this.db, message.sessionId).id);
        return { connected: true, ready: true, authenticated: session.authenticated, version: session.version };
      }
      case "models": return { data: requireSession(this.db, message.sessionId).models.map(item => ({ model: item.id, displayName: item.name })) };
      case "sessionCatalog": {
        const session = await this.ensure(requireSession(this.db, message.sessionId).id);
        return this.deps.request("refresh", { sessionId: session.id, connectionId: session.connectionId });
      }
      case "sessionDraft": {
        const draft = validateDraft(message.draft);
        const updatedAt = Math.min(Date.now(), Number(message.updatedAt) || Date.now());
        await this.deps.mutate(database => {
          const session = requireSession(database, message.sessionId);
          if (updatedAt < (session.draftUpdatedAt ?? 0)) return;
          session.draft = draft; session.draftUpdatedAt = updatedAt;
        });
        return true;
      }
      case "sessionConfig": {
        const id = requireSession(this.db, message.sessionId).id;
        return this.lock(id, async () => {
          const session = requireSession(this.db, id);
          const option = session.configOptions?.find(option => option.id === message.configId && option.category !== "model");
          if (!option || (option.type === "boolean" ? typeof message.value !== "boolean" : !option.options?.some(item => item.value === message.value))) throw new Error("客户端未提供该配置值");
          if (!sessionBusy(session)) await this.deps.request("setConfig", { sessionId: id, connectionId: session.connectionId, configId: option.id, value: message.value });
          await this.deps.mutate(database => {
            const selected = requireSession(database, id);
            selected.nextConfig ??= {};
            if (selected.configOptions?.find(item => item.id === option.id)?.currentValue === message.value) delete selected.nextConfig[option.id];
            else Object.defineProperty(selected.nextConfig, option.id, { value: message.value, enumerable: true, configurable: true, writable: true });
          });
          return true;
        });
      }
      case "sessionModel": {
        const id = requireSession(this.db, message.sessionId).id;
        return this.lock(id, async () => {
          const session = requireSession(this.db, id);
          const model = String(message.model ?? "");
          if (!session.models.some(item => item.id === model)) throw new Error("模型不在此会话的可选列表中");
          if (!session.capabilities.models) throw new Error("此 Agent 未提供模型配置");
          if (!sessionBusy(session)) await this.deps.request("setModel", { sessionId: id, connectionId: session.connectionId, model });
          await this.deps.mutate(database => {
            const session = requireSession(database, id);
            if (session.appliedModel === model) delete session.model;
            else session.model = model;
            const supported = session.models.find(item => item.id === model)?.reasoningEfforts;
            if (supported && session.nextConfig?.effort && !supported.includes(String(session.nextConfig.effort))) delete session.nextConfig.effort;
          });
          return true;
        });
      }
      case "cancel": {
        const session = requireSession(this.db, message.sessionId);
        await this.deps.mutate(database => { requireSession(database, session.id).queuePaused = true; });
        return this.deps.request("cancel", { sessionId: session.id, connectionId: session.connectionId });
      }
      case "sessionPermission": {
        const session = requireSession(this.db, message.sessionId);
        return this.deps.request("permission", { sessionId: session.id, connectionId: session.connectionId, requestId: message.requestId, optionId: message.optionId });
      }
      case "queueRemove": await this.deps.mutate(database => removeQueuedMessage(requireSession(database, message.sessionId), message.messageId)); return true;
      case "queueResume": {
        const id = requireSession(this.db, message.sessionId).id;
        if (requireSession(this.db, id).state !== "idle") throw new Error("请先恢复连接，确认任务状态后再继续队列");
        await this.deps.mutate(database => { requireSession(database, id).queuePaused = false; });
        await this.drain(id); return true;
      }
      case "chat": {
        const text = String(message.text ?? "").trim();
        const content = validateDraft({ text, attachments: message.attachments ?? [], references: message.references ?? [] });
        if (!text && !content.attachments.length && !content.references.length) throw new Error("消息为空");
        const id = requireSession(this.db, message.sessionId).id;
        const references = this.deps.references ? await this.deps.references(content.references) : content.references;
        const base = await this.deps.context(message.context ?? {});
        const context = references.length ? { ...(base as object), references } : base;
        return this.lock(id, async () => {
          let selected = requireSession(this.db, id);
          if (selected.archived) throw new Error("请先恢复归档会话");
          if (selected.state === "unknown") throw new Error("上次执行结果未知，请先恢复连接并核实结果");
          const queued = sessionBusy(selected) || selected.queue.length > 0;
          const mode = message.mode === "steer" ? "steer" : "queue";
          if (mode === "steer" && (!selected.capabilities.steer || selected.state !== "running")) throw new Error("当前会话不支持插话，或本轮已结束");
          if (!queued) selected = await this.ensure(id);
          const command = commandToken(text)?.name;
          if (command && !selected.commands?.some(item => item.name === command)) throw new Error(`客户端未声明 /${command} 命令，请连接后从命令面板选择`);
          if (command && mode === "steer") throw new Error("客户端命令请排队执行");
          if (content.attachments.some(item => item.kind === "image") && selected.capabilities.images === false) throw new Error("此 Agent 未声明图片输入能力");
          const model = selected.models.find(item => item.id === (mode === "steer" ? selected.appliedModel : selected.model ?? selected.appliedModel));
          if (content.attachments.some(item => item.kind === "image") && model?.inputModalities && !model.inputModalities.includes("image")) throw new Error("所选模型不支持图片，请更换模型或移除图片");
          if (references.some(item => item.kind === "skill" && !selected.skills?.some(skill => skill.id === item.id))) throw new Error("技能目录中找不到该引用，请重新选择");
          const item: ChatQueueItem = { id: crypto.randomUUID(), text, context, clientId: message.clientId, time: Date.now(), attachments: content.attachments, references, command };
          if (mode !== "steer" && queued) {
            await this.deps.mutate(database => addUserMessage(requireSession(database, id), item, true)); return { queued: true };
          }
          await this.deps.mutate(database => {
            const session = requireSession(database, id); addUserMessage(session, item, false);
            if (mode !== "steer") session.queuePaused = false;
            if (message.model && selected.models.some(item => item.id === message.model)) session.model = message.model;
            syncChatProjection(database);
          });
          return this.dispatch(id, item, mode);
        });
      }
      default: throw new Error("未知会话操作");
    }
  }
}
