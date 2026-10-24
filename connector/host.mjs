import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FrameDecoder, encodeFrame } from "./framing.mjs";
import { discoverProviders } from "./providers/registry.mjs";
import { SessionHost } from "./session-host.mjs";
import { ToolBroker } from "./tool-broker.mjs";
import { safeError } from "./process.mjs";
import { AttachmentStore } from "./attachments.mjs";
import capabilities from "../shared/capabilities.json" with { type: "json" };

const allowed = "chrome-extension://llkomjgjbldjelaemjcgphogaceejbpi/";
if (process.argv[2] && process.argv[2] !== allowed) process.exit(1);
const emit = message => {
  try { process.stdout.write(encodeFrame(message)); }
  catch {
    const error = "连接器消息超过传输限制";
    if (message.kind === "reply") process.stdout.write(encodeFrame({ kind: "reply", id: message.id, error }));
    else process.stdout.write(encodeFrame({ kind: "event", event: { type: "error", message: error, sessionId: message.event?.sessionId, connectionId: message.event?.connectionId } }));
  }
};
const directory = await mkdtemp(path.join(tmpdir(), "beehelper-"));
await chmod(directory, 0o700);
const workspace = process.env.BEEHELPER_WORKSPACE || path.join(homedir(), ".local/share/beehelper/workspace");
if (!path.isAbsolute(workspace)) throw new Error("本地工作目录必须是绝对路径");
await mkdir(workspace, { recursive: true, mode: 0o700 });
const attachments = new AttachmentStore(path.join(workspace, "attachments"));
const sessions = new SessionHost({
  registry: await discoverProviders(), workspace, version: capabilities.version, attachments,
  mcpPath: fileURLToPath(new URL("./mcp.mjs", import.meta.url)),
  emit: event => emit({ kind: "event", event })
});
sessions.socketPath = path.join(directory, "tools.sock");
const broker = new ToolBroker({ sessions, emit });
await broker.listen(sessions.socketPath);
async function rpc(method, params = {}) {
  if (method === "providers" || method === "diagnostics") {
    const next = await discoverProviders();
    await next.ready;
    const previous = sessions.registry; sessions.registry = next;
    await previous.close();
    const providers = await sessions.catalog();
    return method === "providers" ? providers : { version: capabilities.version, providers };
  }
  if (method === "connect") return sessions.connect(params);
  if (method === "send") return sessions.send(params);
  if (method === "setModel") return sessions.setModel(params);
  if (method === "setConfig") return sessions.setConfig(params);
  if (method === "refresh") return sessions.refresh(params);
  if (method === "attachmentBegin") return attachments.begin(params);
  if (method === "attachmentChunk") return attachments.chunk(params);
  if (method === "attachmentFinish") return attachments.finish(params);
  if (method === "attachmentAbort") return attachments.abort(params);
  if (method === "attachmentRead") return attachments.read(params);
  if (method === "cancel") return sessions.cancel(params);
  if (method === "permission") return sessions.permission(params);
  if (method === "disconnect") return sessions.disconnect(params);
  if (method === "status") {
    const info = await sessions.connect({ sessionId: "doctor", connectionId: "doctor", providerId: "codex" });
    return { ...info, connected: true, ready: true };
  }
  throw new Error("未知连接器方法");
}
const decoder = new FrameDecoder();
process.stdin.on("data", chunk => {
  let messages;
  try { messages = decoder.push(chunk); } catch { void shutdown(); return; }
  for (const message of messages) {
    if (message.kind === "toolResult") broker.reply(message);
    else if (message.kind === "rpc") void rpc(message.method, message.params).then(
      result => emit({ kind: "reply", id: message.id, result }),
      error => emit({ kind: "reply", id: message.id, error: safeError(error) })
    );
  }
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await sessions.close(); await attachments.close(); broker.close();
  await rm(directory, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 1200).unref();
}
process.stdin.on("end", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
