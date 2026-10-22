import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect } from "node:net";
import { tools, serverInstructions } from "./tools.mjs";
import capabilities from "../shared/capabilities.json" with { type: "json" };

const server = new McpServer({ name: "beehelper", version: capabilities.version }, { instructions: serverInstructions });
function invoke(name, args) {
  return new Promise((resolve, reject) => {
    const socket = connect(process.env.BEEHELPER_SOCKET);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.setTimeout(45_000, () => socket.destroy(new Error("浏览器工具响应超时")));
    socket.on("connect", () => socket.write(JSON.stringify({ token: process.env.BEEHELPER_TOKEN, sessionId: process.env.BEEHELPER_SESSION_ID, connectionId: process.env.BEEHELPER_CONNECTION_ID, name, args }) + "\n"));
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 5_000_000) return socket.destroy(new Error("工具响应过大"));
      if (!buffer.includes("\n")) return;
      try {
        const reply = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        reply.error ? reject(new Error(reply.error)) : resolve(reply.result);
      } catch (error) { reject(error); }
      socket.end();
    });
    socket.on("error", reject);
    socket.on("end", () => { if (!buffer.includes("\n")) reject(new Error("工具连接提前关闭")); });
  });
}
for (const [name, description, inputSchema] of tools) {
  const readOnlyHint = ["capabilities_get", "microapp_list", "microapp_get", "run_list", "run_get", "browser_tabs", "browser_inspect", "userscript_search"].includes(name);
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, destructiveHint: ["microapp_run", "microapp_install", "browser_action", "userscript_import"].includes(name), openWorldHint: name.startsWith("browser_") || ["microapp_run", "microapp_install", "userscript_search", "userscript_import"].includes(name) } }, async args => {
    try {
      const result = await invoke(name, args);
      return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: String(error) }] }; }
  });
}
await server.connect(new StdioServerTransport());
