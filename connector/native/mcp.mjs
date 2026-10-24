import { connect } from "node:net";
import { tools, serverInstructions } from "../tools.mjs";
import capabilities from "../../shared/capabilities.json" with { type: "json" };
import { toolSchemas } from "bee:tool-schemas";

function invoke(name, args) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.BEEHELPER_SOCKET); let buffer = "", finished = false;
    const fail = error => { if (!finished) { finished = true; reject(error); } };
    socket.setTimeout(45_000, () => { fail(new Error("浏览器工具响应超时")); socket.destroy(); });
    socket.on("connect", () => socket.write(JSON.stringify({ token: process.env.BEEHELPER_TOKEN, sessionId: process.env.BEEHELPER_SESSION_ID, connectionId: process.env.BEEHELPER_CONNECTION_ID, name, args })+"\n"));
    socket.on("data", text => {
      buffer += text;
      if (Buffer.byteLength(buffer) > 5_000_000) { fail(new Error("工具响应过大")); socket.destroy(); return; }
      if (!buffer.includes("\n") || finished) return;
      try { const value = JSON.parse(buffer.slice(0, buffer.indexOf("\n"))); finished = true; value.error ? reject(new Error(value.error)) : resolve(value.result); }
      catch (error) { fail(error); }
      socket.end();
    });
    socket.on("error", fail); socket.on("end", () => fail(new Error("工具连接提前关闭")));
  });
}
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value })+"\n");
async function handle(message) {
  if (message.id === undefined) return;
  const { id, method, params = {} } = message;
  try {
    let result;
    if (method === "initialize") {
      const supported = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
      result = { protocolVersion: supported.includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "beehelper", version: capabilities.version }, instructions: serverInstructions };
    } else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools: tools.map(([name, description]) => ({ name, description, inputSchema: toolSchemas[name], annotations: { readOnlyHint: ["capabilities_get", "microapp_list", "microapp_get", "run_list", "run_get", "browser_tabs", "browser_inspect", "userscript_search"].includes(name), destructiveHint: ["microapp_run", "microapp_install", "browser_action", "userscript_import"].includes(name), openWorldHint: name.startsWith("browser_") || ["microapp_run", "microapp_install", "userscript_search", "userscript_import"].includes(name) } })) };
    else if (method === "tools/call") {
      const tool = tools.find(item => item[0] === params.name);
      if (!tool) throw new Error("未知工具");
      try {
        const args = {};
        for (const [key, schema] of Object.entries(tool[2])) {
          const parsed = schema.parse(params.arguments?.[key]); if (parsed !== undefined) args[key] = parsed;
        }
        result = { content: [{ type: "text", text: JSON.stringify(await invoke(params.name, args) ?? null) }] };
      } catch (error) { result = { isError: true, content: [{ type: "text", text: String(error) }] }; }
    } else { send({ id, error: { code: -32601, message: "未知 MCP 方法" } }); return; }
    send({ id, result });
  } catch (error) { send({ id, error: { code: -32602, message: String(error) } }); }
}
let buffer = "";
const decoder = new TextDecoder();
process.stdin.on("data", chunk => {
  buffer += decoder.decode(chunk, { stream: true });
  if (Buffer.byteLength(buffer) > 5_000_000) process.exit(1);
  let boundary;
  while ((boundary = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary+1);
    try { void handle(JSON.parse(line)); } catch { send({ id: null, error: { code: -32700, message: "无效 JSON" } }); }
  }
});
process.stdin.on("end", () => process.exit(0));
