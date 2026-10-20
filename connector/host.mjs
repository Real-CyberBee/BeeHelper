import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { FrameDecoder, encodeFrame } from "./framing.mjs";
import { agentInstructions, tools, formatTaskInput } from "./tools.mjs";
import capabilities from "../shared/capabilities.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));
const allowed = "chrome-extension://llkomjgjbldjelaemjcgphogaceejbpi/";
if (process.argv[2] && process.argv[2] !== allowed) process.exit(1);
const emit = message => { try { process.stdout.write(encodeFrame(message)); } catch { process.stdout.write(encodeFrame({ kind: "event", event: { type: "error", message: "连接器消息超过传输限制" } })); } };
const event = data => emit({ kind: "event", event: data });
const directory = await mkdtemp(path.join(tmpdir(), "beehelper-"));
await chmod(directory, 0o700);
const socketPath = path.join(directory, "tools.sock");
const token = randomBytes(32).toString("hex");
const workspace = path.join(homedir(), ".local", "share", "beehelper", "workspace");
await mkdir(workspace, { recursive: true, mode: 0o700 });
const browserRequests = new Map();
const sockets = new Set();
const toolNames = new Set(tools.map(tool => tool[0]));
const server = createServer(socket => {
  socket.setEncoding("utf8");
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  let buffer = "";
  socket.setTimeout(50_000, () => socket.destroy());
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    if (buffer.length > 2_000_000) return socket.destroy();
    if (!buffer.includes("\n")) return;
    let request;
    try { request = JSON.parse(buffer.slice(0, buffer.indexOf("\n"))); } catch { return socket.destroy(); }
    buffer = "";
    const incoming = Buffer.from(String(request.token ?? ""));
    if (incoming.length !== token.length || !timingSafeEqual(incoming, Buffer.from(token)) || !toolNames.has(request.name)) return socket.destroy();
    const id = randomBytes(16).toString("hex");
    const timeout = setTimeout(() => { browserRequests.delete(id); socket.end(JSON.stringify({ error: "浏览器工具超时，执行结果可能未知，请勿盲目重试" }) + "\n"); }, 40_000);
    browserRequests.set(id, result => { clearTimeout(timeout); socket.end(JSON.stringify(result) + "\n"); });
    socket.once("close", () => { clearTimeout(timeout); browserRequests.delete(id); });
    event({ type: "tool", message: request.name });
    emit({ kind: "tool", id, name: request.name, args: request.args });
  });
});
await new Promise(resolve => server.listen(socketPath, resolve));
await chmod(socketPath, 0o600);
let child;
let initialization;
let sequence = 0;
let busy = false;
let currentThread;
let currentTurn;
const requests = new Map();
const codexPath = process.env.BEEHELPER_CODEX || "codex";
function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { requests.delete(id); reject(new Error(`Codex 请求超时：${method}`)); }, 50_000);
    requests.set(id, { resolve, reject, timeout });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
async function startCodex() {
  if (initialization) return initialization;
  initialization = (async () => {
    const configuration = `mcp_servers={beehelper={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(path.join(here, "mcp.mjs"))}],env_vars=["BEEHELPER_SOCKET","BEEHELPER_TOKEN"],required=true,default_tools_approval_mode="approve"}}`;
    child = spawn(codexPath, ["app-server", "--listen", "stdio://", "-c", configuration], {
      stdio: ["pipe", "pipe", "pipe"], cwd: workspace,
      env: { ...process.env, BEEHELPER_SOCKET: socketPath, BEEHELPER_TOKEN: token }
    });
    child.on("error", error => { initialization = undefined; event({ type: "error", message: `无法启动 Codex：${error.message}` }); for (const pending of requests.values()) { clearTimeout(pending.timeout); pending.reject(error); } requests.clear(); });
    let diagnostic = "";
    child.stderr.on("data", data => { diagnostic = (diagnostic + data.toString()).slice(-3000); });
    child.on("exit", code => {
      initialization = undefined; busy = false;
      for (const pending of requests.values()) { clearTimeout(pending.timeout); pending.reject(new Error(`Codex 已退出（${code}）`)); } requests.clear();
      event({ type: "error", message: `Codex 进程已结束（${code}）${diagnostic.includes("error loading config") ? "：配置载入失败" : ""}` });
      event({ type: "done", status: "failed" });
    });
    createInterface({ input: child.stdout }).on("line", line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const pending = requests.get(message.id);
        if (pending) { clearTimeout(pending.timeout); requests.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
        return;
      }
      const params = message.params ?? {};
      if (message.method === "item/agentMessage/delta") event({ type: "delta", text: params.delta, messageId: params.itemId ?? `assistant:${params.turnId}`, threadId: params.threadId });
      if (message.method === "turn/started") { currentTurn = params.turn?.id; event({ type: "busy", value: true }); }
      if (message.method === "turn/completed") {
        busy = false; currentTurn = undefined;
        if (params.turn?.error) event({ type: "error", message: params.turn.error.message ?? "Codex 执行失败" });
        event({ type: "done", status: params.turn?.status });
      }
      if (message.method === "error") event({ type: "error", message: params.error?.message ?? "Codex 错误" });
      if (message.method === "item/completed" && params.item?.type === "mcpToolCall") {
        const item = params.item;
        event({ type: "tool", message: `${item.server}/${item.tool} · ${item.status}${item.error ? " · " + JSON.stringify(item.error).slice(0, 1200) : ""}` });
      }
      if (message.id !== undefined && message.method) {
        event({ type: "tool", message: `未授权的额外请求：${message.method}` });
        child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32000, message: "此本地连接器不接受交互审批；请在 BeeHelper 中重新描述任务" } }) + "\n");
      }
    });
    await call("initialize", { clientInfo: { name: "beehelper", title: "BeeHelper", version: capabilities.version } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    event({ type: "status", status: { connected: true, ready: true } });
  })();
  try { await initialization; } catch (error) { initialization = undefined; throw error; }
}
async function rpc(method, params) {
  await startCodex();
  if (method === "status") {
    const account = await call("account/read", { refreshToken: false });
    let version = "未知";
    try { version = execFileSync(codexPath, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim(); } catch {}
    const status = { connected: true, ready: true, authenticated: Boolean(account.account), version, busy };
    event({ type: "status", status }); return status;
  }
  if (method === "models") return call("model/list", { limit: 100, includeHidden: false });
  if (method === "cancel") {
    if (currentThread && currentTurn) return call("turn/interrupt", { threadId: currentThread, turnId: currentTurn });
    return { cancelled: false };
  }
  if (method === "reset") {
    if (busy) throw new Error("请先停止当前任务");
    currentThread = undefined; return true;
  }
  if (method === "chat") {
    if (busy) throw new Error("Codex 正在运行，请等待或停止当前任务");
    busy = true;
    event({ type: "busy", value: true });
    try {
      const base = { cwd: workspace, developerInstructions: agentInstructions, approvalPolicy: "never", sandbox: "read-only", ...(params.model ? { model: params.model } : {}) };
      if (!currentThread) {
        const result = params.threadId ? await call("thread/resume", { ...base, threadId: params.threadId }) : await call("thread/start", base);
        currentThread = result.thread.id;
        event({ type: "thread", threadId: currentThread });
      }
      const result = await call("turn/start", { threadId: currentThread, input: [{ type: "text", text: formatTaskInput(params.text, params.context) }], ...(params.model ? { model: params.model } : {}) });
      currentTurn = result.turn.id;
      return { threadId: currentThread, turnId: currentTurn };
    } catch (error) { busy = false; event({ type: "done", status: "failed" }); throw error; }
  }
  throw new Error("未知连接器方法");
}
const decoder = new FrameDecoder();
process.stdin.on("data", chunk => {
  let messages;
  try { messages = decoder.push(chunk); } catch { void shutdown(); return; }
  for (const message of messages) {
    if (message.kind === "toolResult") {
      const callback = browserRequests.get(message.id);
      if (callback) { browserRequests.delete(message.id); callback({ result: message.result, error: message.error }); }
    } else if (message.kind === "rpc") {
      void rpc(message.method, message.params ?? {}).then(result => emit({ kind: "reply", id: message.id, result }), error => emit({ kind: "reply", id: message.id, error: error.message ?? String(error) }));
    }
  }
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  child?.kill("SIGTERM");
  for (const socket of sockets) socket.destroy();
  server.close();
  await rm(directory, { recursive: true, force: true });
  setTimeout(() => { child?.kill("SIGKILL"); process.exit(0); }, 1000).unref();
}
process.stdin.on("end", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
