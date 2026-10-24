import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) { console.log("codex-cli fixture"); process.exit(0); }
const acp = process.argv.includes("--acp-fixture");
const output = message => process.stdout.write(JSON.stringify(message) + "\n");
const reply = (id, result) => output({ jsonrpc: "2.0", id, result });
let turn, pending, count = 0, model = process.argv.includes("--dynamic-models") ? "auto" : "alpha";
let nativeSessionId = `fixture-${process.pid}`;
let pendingConnect, mcpServer;
let mode = "code";
const options = () => [{ id: "model", category: "model", name: "Model", type: "select", currentValue: model, options: [...(model === "auto" ? [{ value: "auto", name: "Default" }] : []), { value: "alpha", name: "Alpha" }, { value: "beta", name: "Beta" }] }, { id: "mode", category: "mode", name: "会话模式", type: "select", currentValue: mode, options: [{ value: "code", name: "执行" }, { value: "plan", name: "规划" }] }];
function event(method, params) { output({ jsonrpc: "2.0", method, params }); }
function chunk(text) {
  if (acp) event("session/update", { sessionId: nativeSessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
  else event("item/agentMessage/delta", { threadId: nativeSessionId, turnId: turn, itemId: `answer-${turn}`, delta: text });
}
function complete(status = "completed") {
  if (acp && pending) reply(pending, { stopReason: status === "completed" ? "end_turn" : "cancelled" });
  else if (turn) event("turn/completed", { threadId: nativeSessionId, turn: { id: turn, status } });
  pending = undefined; turn = undefined;
}
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (!message.method && message.id === 50000 && pendingConnect) {
    const id = pendingConnect; pendingConnect = undefined;
    if (message.result?.outcome?.outcome === "selected") reply(id, { sessionId: nativeSessionId, configOptions: options() });
    else output({ jsonrpc: "2.0", id, error: { code: -32000, message: "permission declined" } });
    return;
  }
  if (message.method === "initialize") {
    reply(message.id, acp ? { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} }, promptCapabilities: { image: true, embeddedContext: true } }, _meta: { steering: { supported: true } } } : {});
  } else if (message.method === "account/read") reply(message.id, { account: { type: "chatgpt" } });
  else if (message.method === "thread/start" || message.method === "thread/resume") {
    if (message.params.threadId) nativeSessionId = message.params.threadId;
    reply(message.id, { thread: { id: nativeSessionId }, model, ...(process.argv.includes("--configured-effort") ? { reasoningEffort: "high" } : {}) });
  }
  else if (message.method === "model/list") reply(message.id, { data: [{ model: "alpha", displayName: "Alpha", inputModalities: ["text", "image"], defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] }, { model: "beta", displayName: "Beta", inputModalities: ["text"], defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }], nextCursor: null });
  else if (message.method === "skills/list") reply(message.id, { data: [{ skills: [{ name: "fixture-skill", path: "/tmp/beehelper-fixture-skill/SKILL.md", description: "协议测试技能", enabled: true, scope: "user" }] }] });
  else if (message.method === "session/new" || message.method === "session/resume") {
    if (message.params.sessionId) nativeSessionId = message.params.sessionId;
    if (process.argv.includes("--permission-on-connect")) {
      pendingConnect = message.id;
      output({ jsonrpc: "2.0", id: 50000, method: "session/request_permission", params: { sessionId: nativeSessionId, toolCall: { toolCallId: "initial-trust", title: "测试连接授权", status: "pending" }, options: [{ optionId: "once", name: "允许本次", kind: "allow_once" }, { optionId: "reject", name: "拒绝", kind: "reject_once" }] } });
      return;
    }
    mcpServer = message.params.mcpServers?.find(server => server.name === "beehelper");
    reply(message.id, { sessionId: nativeSessionId, configOptions: options() });
    event("session/update", { sessionId: nativeSessionId, update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "fixture-native", description: "测试原生命令", input: { hint: "参数" } }] } });
  }
  else if (message.method === "session/set_config_option") {
    if (message.params.configId === "mode") mode = message.params.value;
    else model = message.params.value;
    reply(message.id, { configOptions: options() });
  } else if (message.method === "turn/start" || message.method === "session/prompt") {
    turn = `turn-${++count}`; pending = message.id;
    if (message.params.model) model = message.params.model;
    if (!acp) {
      reply(message.id, { turn: { id: turn, status: "inProgress" } });
      event("turn/started", { threadId: nativeSessionId, turn: { id: turn } });
    }
    const text = (message.params.input ?? message.params.prompt)[0].text;
    chunk(`fixture:${text.includes("hold-test") ? "hold-test" : text.includes("queued-test") ? "queued-test" : "answer"}:${model}`);
    if (process.argv.includes("--inspect-effort")) chunk(`:effort:${message.params.effort ?? "unset"}`);
    const content = message.params.input ?? message.params.prompt;
    if (content.some(item => ["localImage", "image"].includes(item.type))) chunk(":image-received");
    if (content.some(item => item.type === "skill")) chunk(":skill-received");
    if (content.some(item => ["resource", "resource_link"].includes(item.type)) || text.includes("用户主动上传的文件材料")) chunk(":file-received");
    if (text.startsWith("/fixture-native")) chunk(":native-command-first");
    if (text.includes("markdown-test")) chunk('\n\n## 结果\n\n| 字段 | 值 |\n| --- | --- |\n| count | 2 |\n\n```js\nconst count = 2;\n```\n\n[不可执行](javascript:alert(1))\n\n![远程图片](https://beehelper-image.invalid/pixel.gif)\n\n<script>window.__unsafe = true</script>');
    if (process.argv.includes("--native-mcp-probe") && mcpServer) {
      const env = { ...process.env, ...Object.fromEntries(mcpServer.env.map(item => [item.name, item.value])) };
      if (process.argv.includes("--invalid-token")) env.BEEHELPER_TOKEN = "bad";
      const child = spawn(mcpServer.command, mcpServer.args, { env, stdio: ["pipe", "pipe", "ignore"] });
      child.stdout.setEncoding("utf8"); let buffer = "";
      child.stdout.on("data", data => {
        buffer += data; let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const response = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index+1);
          if (response.id === 1) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "capabilities_get", arguments: {} } })+"\n");
          if (response.id === 2) { chunk(":mcp-result:"+JSON.stringify(response.result)); child.stdin.end(); complete(); }
        }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } })+"\n");
    } else if (text.includes("fail-test")) {
      if (acp) { output({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "fixture failed" } }); pending = undefined; }
      else setTimeout(() => complete("failed"), 25);
    } else if (!text.includes("hold-test")) setTimeout(() => complete(), 200);
  } else if (message.method === "thread/compact/start") {
    turn = `turn-${++count}`; reply(message.id, {});
    event("turn/started", { threadId: nativeSessionId, turn: { id: turn } }); chunk("fixture:compacted"); setTimeout(() => complete(), 100);
  } else if (message.method === "turn/steer" || message.method === "_session/steering") {
    if (!turn) return output({ id: message.id, error: { code: -32000, message: "No active turn" } });
    reply(message.id, acp ? { outcome: "injected" } : { turnId: turn });
    chunk(":steered"); setTimeout(() => complete(), 100);
  } else if (message.method === "turn/interrupt") { reply(message.id, {}); complete("interrupted"); }
  else if (message.method === "session/cancel") complete("interrupted");
});
