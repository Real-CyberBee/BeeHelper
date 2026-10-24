import { spawn } from "node:child_process";

export function safeError(error) {
  return String(error?.message ?? error)
    .replace(/Bearer\s+\S+/gi, "Bearer <REDACTED>")
    .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,})\b/g, "<REDACTED>")
    .replace(/((?:token|api[_-]?key|password|secret)\s*[:=]\s*)["']?[^"',\s}]+/gi, "$1<REDACTED>");
}
export function spawnAgent(launch, options = {}) {
  return spawn(launch.command, launch.args ?? [], {
    cwd: options.cwd, env: { ...process.env, ...launch.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"]
  });
}
export class JsonRpcProcess {
  constructor(launch, { cwd, env, onNotification = () => {}, onRequest, onExit = () => {}, jsonrpc = false } = {}) {
    this.jsonrpc = jsonrpc;
    this.child = spawnAgent(launch, { cwd, env });
    this.pending = new Map(); this.sequence = 0; this.closed = false;
    const fail = error => { if (!this.closed) { this.close(error); onExit(error); } };
    this.child.stderr.resume();
    this.child.stdout.setEncoding("utf8");
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > 5_000_000) return fail(new Error("Agent 消息超过传输上限"));
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        if (message.id !== undefined && !message.method) {
          const request = this.pending.get(message.id);
          if (request) {
            this.pending.delete(message.id); clearTimeout(request.timer);
            message.error ? request.reject(new Error(safeError(message.error.message))) : request.resolve(message.result);
          }
        } else if (message.method && message.id !== undefined) {
          Promise.resolve().then(() => {
            if (!onRequest) throw new Error("客户端未实现此交互");
            return onRequest(message.method, message.params ?? {});
          }).then(result => this.write({ id: message.id, result }), error => this.write({ id: message.id, error: { code: -32000, message: safeError(error) } })).catch(() => {});
        } else if (message.method) { try { onNotification(message.method, message.params ?? {}); } catch (error) { fail(error); } }
      }
    });
    this.child.stdin.on("error", fail);
    this.child.once("error", fail);
    this.child.once("exit", code => {
      fail(new Error(`Agent 进程已结束（${code}）；请检查本地客户端配置`));
    });
  }
  write(message) {
    if (this.closed) throw new Error("Agent 连接已关闭");
    this.child.stdin.write(JSON.stringify(this.jsonrpc ? { jsonrpc: "2.0", ...message } : message) + "\n");
  }
  notify(method, params = {}) { this.write({ method, params }); }
  call(method, params = {}, timeout = 45_000) {
    if (this.closed) return Promise.reject(new Error("Agent 连接已关闭"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => { this.pending.delete(id); reject(new Error(`Agent 请求超时：${method}，结果可能未知`)); }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close(error = new Error("Agent 连接已关闭")) {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear(); this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 1000); timer.unref();
  }
}
