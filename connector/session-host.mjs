import { randomUUID, randomBytes } from "node:crypto";
import { safeError } from "./process.mjs";

export class SessionHost {
  constructor({ registry, workspace, mcpPath, emit, version, attachments }) {
    Object.assign(this, { registry, workspace, mcpPath, emit, version, attachments });
    this.sessions = new Map();
  }
  async catalog() { await this.registry.ready; return this.registry.catalog(); }
  scope(id, connectionId) {
    const session = this.sessions.get(id);
    return session?.connectionId === connectionId && !session.closed ? session : undefined;
  }
  async connect(params) {
    await this.registry.ready;
    if (!params.sessionId || !params.connectionId) throw new Error("缺少会话或连接标识");
    let session = this.sessions.get(params.sessionId);
    if (session && !session.closed && session.connectionId === params.connectionId) {
      if (session.providerId !== params.providerId) throw new Error("不能修改既有会话的 Agent");
      await session.ready; return session.metadata;
    }
    if (session?.running) throw new Error("旧连接仍有在途任务，不能重新连接");
    session?.adapter?.close();
    const plugin = this.registry.get(params.providerId);
    session = { sessionId: params.sessionId, providerId: params.providerId, connectionId: params.connectionId, token: randomBytes(32).toString("hex"), running: false, closed: false, permissions: new Map(), metadataVersion: 0 };
    this.sessions.set(session.sessionId, session);
    const emit = event => {
      if (this.scope(session.sessionId, session.connectionId) !== session) return;
      if (event.type === "session") {
        event = { ...event, metadataVersion: ++session.metadataVersion };
        const { type, ...metadata } = event; session.metadata = { ...session.metadata, ...metadata };
      }
      if (event.message) event = { ...event, message: safeError(event.message) };
      this.emit({ ...event, sessionId: session.sessionId, connectionId: session.connectionId });
    };
    session.emit = emit;
    session.ready = (async () => {
      session.adapter = await plugin.create({
        workspace: this.workspace, version: this.version, emit,
        mcp: { command: process.execPath, args: [this.mcpPath], env: { BEEHELPER_SOCKET: this.socketPath, BEEHELPER_TOKEN: session.token, BEEHELPER_SESSION_ID: session.sessionId, BEEHELPER_CONNECTION_ID: session.connectionId } },
        onExit: error => this.disconnected(session, error),
        permission: request => new Promise(resolve => {
          const id = randomUUID();
          const timer = setTimeout(() => finish(undefined), 300_000);
          const finish = choice => { clearTimeout(timer); session.permissions.delete(id); emit({ type: "permission", requestId: id }); resolve(choice); };
          session.permissions.set(id, { options: request.options, finish });
          emit({ type: "permission", permission: { id, title: request.title, options: request.options } });
        })
      });
      const version = session.metadataVersion;
      const initial = await session.adapter.connect(params.nativeSessionId);
      updateMetadata(session, initial, version);
      emit({ type: "state", state: "idle" });
      return session.metadata;
    })();
    try { await session.ready; return session.metadata; } catch (error) { this.disconnected(session, error); throw error; }
  }
  require(params) {
    const session = this.scope(params.sessionId, params.connectionId);
    if (!session) throw new Error("会话连接已失效，请重新连接");
    return session;
  }
  async send(params) {
    const session = this.require(params);
    await session.ready;
    const task = { ...params, attachments: params.attachments?.length ? await this.attachments?.prepare(session.sessionId, params.attachments) : [] };
    if (params.attachments?.length && !task.attachments) throw new Error("附件服务不可用");
    if (params.mode === "steer") {
      if (!session.running) throw new Error("当前轮已结束，消息未投递");
      if (!session.metadata.capabilities.steer) throw new Error("此 Agent 未声明插话能力，可改为排队");
      await session.adapter.steer(task); return { accepted: true };
    }
    if (session.running) throw new Error("会话正在运行，请排队或使用插话");
    session.running = true; session.emit({ type: "state", state: "running" });
    // 只接收一次投递；队列由扩展持有，不在适配器外再排第二次。
    void Promise.resolve().then(() => session.adapter.prompt(task)).then(status => {
      if (session.closed) return;
      session.running = false;
      session.emit({ type: "done", status });
    }, error => {
      if (session.closed) return;
      session.running = false;
      session.emit({ type: "delivery", messageId: params.messageId, status: "failed" });
      session.emit({ type: "error", message: safeError(error) });
      session.emit({ type: "done", status: "failed" });
    });
    return { accepted: true };
  }
  async setModel(params) {
    const session = this.require(params); await session.ready;
    if (session.running) throw new Error("运行中模型从下一轮生效，请等待当前轮结束");
    const version = session.metadataVersion, result = await session.adapter.setModel(params.model);
    return updateMetadata(session, result, version);
  }
  async setConfig(params) {
    const session = this.require(params); await session.ready;
    if (session.running) throw new Error("运行中配置从下一轮生效");
    if (!session.adapter.setConfig) throw new Error("此客户端未提供会话配置接口");
    const version = session.metadataVersion, result = await session.adapter.setConfig(params.configId, params.value);
    return updateMetadata(session, result, version);
  }
  async refresh(params) {
    const session = this.require(params); await session.ready;
    const version = session.metadataVersion;
    const result = session.adapter.refresh ? await session.adapter.refresh() : session.metadata;
    return updateMetadata(session, result, version);
  }
  async cancel(params) {
    const session = this.require(params);
    if (!session.running) return { cancelled: false };
    session.emit({ type: "state", state: "stopping" });
    try {
      for (const request of [...session.permissions.values()]) request.finish(undefined);
      await session.adapter.cancel();
      return { requested: true };
    } catch (error) { session.emit({ type: "state", state: "running" }); throw error; }
  }
  permission(params) {
    const session = this.require(params);
    const request = session.permissions.get(params.requestId);
    if (!request) throw new Error("授权请求已失效");
    if (params.optionId && !request.options.some(option => option.id === params.optionId)) throw new Error("无效授权选项");
    request.finish(params.optionId); return true;
  }
  disconnect(params) {
    const session = this.scope(params.sessionId, params.connectionId);
    if (!session) return false;
    if (session.running) throw new Error("请先停止任务");
    session.closed = true;
    for (const request of [...session.permissions.values()]) request.finish(undefined);
    session.adapter?.close(); this.sessions.delete(session.sessionId);
    return true;
  }
  disconnected(session, error) {
    if (session.closed) return;
    session.emit({ type: "error", message: safeError(error) });
    session.emit({ type: "state", state: "unknown" });
    session.closed = true; session.running = false;
    for (const request of [...session.permissions.values()]) request.finish(undefined);
    session.adapter?.close();
  }
  close() {
    for (const session of this.sessions.values()) {
      session.closed = true;
      for (const request of [...session.permissions.values()]) request.finish(undefined);
      session.adapter?.close();
    }
    this.sessions.clear(); return this.registry.close();
  }
}
function updateMetadata(session, result, version) {
  const { nextTurn, type, ...snapshot } = result;
  // 异步通知早于请求返回时，保留通知中较新的目录与配置。
  session.metadata = session.metadataVersion > version ? { ...snapshot, ...session.metadata } : { ...session.metadata, ...snapshot };
  session.emit({ type: "session", ...session.metadata });
  return { ...session.metadata, ...(nextTurn ? { nextTurn: true } : {}) };
}
