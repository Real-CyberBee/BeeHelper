import { createServer } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod } from "node:fs/promises";
import { tools } from "./tools.mjs";

export class ToolBroker {
  constructor({ sessions, emit }) {
    this.sessions = sessions; this.emit = emit; this.pending = new Map(); this.sockets = new Set();
    const names = new Set(tools.map(tool => tool[0]));
    this.server = createServer(socket => {
      this.sockets.add(socket); socket.setEncoding("utf8"); socket.on("error", () => {});
      socket.on("close", () => this.sockets.delete(socket));
      socket.setTimeout(50_000, () => socket.destroy());
      let buffer = "", handled = false;
      socket.on("data", chunk => {
        if (handled) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 2_000_000) return socket.destroy();
        if (!buffer.includes("\n")) return;
        handled = true;
        let request;
        try { request = JSON.parse(buffer.slice(0, buffer.indexOf("\n"))); } catch { return socket.destroy(); }
        const scope = this.sessions.scope(request.sessionId, request.connectionId);
        const token = Buffer.from(String(request.token ?? ""));
        if (!scope || token.length !== scope.token.length || !timingSafeEqual(token, Buffer.from(scope.token)) || !names.has(request.name)) return socket.destroy();
        const id = randomBytes(16).toString("hex");
        const finish = reply => { clearTimeout(timer); this.pending.delete(id); socket.end(JSON.stringify(reply) + "\n"); };
        const timer = setTimeout(() => finish({ error: "浏览器工具超时，结果可能未知，请勿盲目重试" }), 40_000);
        this.pending.set(id, { finish, sessionId: request.sessionId, connectionId: request.connectionId });
        socket.once("close", () => { clearTimeout(timer); this.pending.delete(id); });
        scope.emit({ type: "tool", message: request.name });
        this.emit({ kind: "tool", id, name: request.name, args: request.args, sessionId: request.sessionId, connectionId: request.connectionId });
      });
    });
  }
  async listen(socketPath) {
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(socketPath, resolve); });
    if (process.platform !== "win32") await chmod(socketPath, 0o600);
  }
  reply(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (!this.sessions.scope(pending.sessionId, pending.connectionId)) pending.finish({ error: "工具所属会话已断开，不再接收旧结果" });
    else pending.finish({ result: message.result, error: message.error });
  }
  close() {
    for (const socket of this.sockets) socket.destroy();
    this.pending.clear(); this.server.close();
  }
}
