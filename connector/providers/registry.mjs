import { access, readdir, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexAdapter } from "./codex.mjs";
import { createAcpAdapter } from "./acp.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function exists(file) { try { await access(file, constants.F_OK); return true; } catch { return false; } }
export async function findExecutable(name, override) {
  if (override) {
    if (!path.isAbsolute(override)) throw new Error(`${name} 的指定路径必须是绝对路径`);
    return await exists(override) ? override : undefined;
  }
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const nvm = path.join(homedir(), ".nvm/versions/node");
  try { for (const version of (await readdir(nvm)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) dirs.push(path.join(nvm, version, "bin")); } catch {}
  for (const dir of new Set(dirs.filter(Boolean))) {
    const file = path.join(dir, name);
    if (await exists(file)) return file;
  }
}
export async function executableLaunch(file, args = []) {
  const resolved = await realpath(file);
  if (/\.[cm]?js$/.test(resolved)) {
    const siblingNode = path.join(path.dirname(file), "node");
    const runtime = await exists(siblingNode) ? siblingNode : process.versions?.node ? process.execPath : await findExecutable("node");
    if (!runtime) throw new Error("此第三方 Agent 的 JavaScript 入口需要其自己的 Node 运行时");
    return { command: runtime, args: [file, ...args] };
  }
  return { command: file, args };
}
export function createProviderRegistry(plugins) {
  if (new Set(plugins.map(plugin => plugin.id)).size !== plugins.length) throw new Error("Agent 插件 ID 重复");
  const providers = new Map(plugins.map(plugin => [plugin.id, plugin]));
  return {
    ready: Promise.resolve(),
    catalog: () => [...providers.values()].map(({ id, name, available, installed, reason, protocol }) => ({ id, name, available, installed, reason, protocol })),
    get(id) {
      const plugin = providers.get(id);
      if (!plugin) throw new Error("Agent 插件不存在");
      if (!plugin.available) throw new Error(plugin.reason ?? "Agent 不可用");
      return plugin;
    },
    close: async () => { providers.clear(); }
  };
}

export async function discoverProviders() {
  const codex = await findExecutable("codex", process.env.BEEHELPER_CODEX);
  const claude = await findExecutable("claude", process.env.BEEHELPER_CLAUDE);
  const dsh = await findExecutable("dsh", process.env.BEEHELPER_DSH);
  const codebuddy = await findExecutable("codebuddy", process.env.BEEHELPER_CODEBUDDY);
  const localClaudeEntry = path.join(root, "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js");
  const claudeEntry = process.env.BEEHELPER_CLAUDE_ACP ? await findExecutable("claude-agent-acp", process.env.BEEHELPER_CLAUDE_ACP)
    : process.versions?.node && await exists(localClaudeEntry) ? localClaudeEntry : await findExecutable("claude-agent-acp");
  const plugins = [
    { id: "codex", name: "Codex", protocol: "codex-app-server", installed: Boolean(codex), available: Boolean(codex), reason: codex ? undefined : "未找到 Codex CLI", create: async options => createCodexAdapter({ ...options, launch: await executableLaunch(codex) }) },
    { id: "claude", name: "Claude Code", protocol: "acp", installed: Boolean(claude), available: Boolean(claude) && Boolean(claudeEntry), reason: !claude ? "未找到 Claude Code CLI" : !claudeEntry ? "需要独立 Claude ACP 适配器；轻量安装包不捆绑第三方运行引擎" : undefined, create: async options => createAcpAdapter({ ...options, launch: { ...await executableLaunch(claudeEntry), env: { CLAUDE_CODE_EXECUTABLE: claude } } }) },
    { id: "dsh", name: "DeepSeek Harness", protocol: "acp", installed: Boolean(dsh), available: Boolean(dsh), reason: dsh ? undefined : "未找到 dsh，可通过 BEEHELPER_DSH 指定路径", create: async options => createAcpAdapter({ ...options, launch: await executableLaunch(dsh, ["--profile", "acp"]) }) },
    { id: "codebuddy", name: "CodeBuddy Code", protocol: "acp", installed: Boolean(codebuddy), available: Boolean(codebuddy), reason: "未找到独立 CodeBuddy CLI；WorkBuddy 桌面安装不等于可用 CLI", create: async options => createAcpAdapter({ ...options, launch: await executableLaunch(codebuddy, ["--acp"]) }) },
    { id: "workbuddy", name: "WorkBuddy", protocol: "open-api", installed: await exists("/Applications/WorkBuddy.app"), available: false, reason: "桌面登录不提供公开 stdio 会话控制。需官方开放平台授权及独立 API 适配；不会读取桌面凭据。" }
  ];
  // 本机配置只注册 ACP 进程插件，不执行 shell 字符串，也不向浏览器回传 env。
  try {
    const configFile = process.env.BEEHELPER_AGENTS_CONFIG || path.join(root, ".local/agents.json");
    if (!path.isAbsolute(configFile)) throw new Error("ACP 配置文件必须是绝对路径");
    const config = JSON.parse(await readFile(configFile, "utf8"));
    if (!Array.isArray(config.agents) || config.agents.length > 20) throw new Error("agents 必须是最多 20 项的数组");
    for (const definition of config.agents) {
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(definition.id) || typeof definition.name !== "string" || !path.isAbsolute(definition.command) || !Array.isArray(definition.args) || !definition.args.every(value => typeof value === "string")) throw new Error("自定义 ACP 插件配置无效");
      if (definition.env && Object.values(definition.env).some(value => typeof value !== "string")) throw new Error("ACP 环境变量必须是字符串");
      plugins.push({ id: definition.id, name: definition.name, protocol: "acp", installed: await exists(definition.command), available: await exists(definition.command), reason: "指定的 ACP 进程不存在", create: options => createAcpAdapter({ ...options, launch: { command: definition.command, args: definition.args, env: definition.env } }) });
    }
  } catch (error) { if (error.code !== "ENOENT") throw new Error("本机 ACP 插件配置无法读取，请检查 .local/agents.json 的格式和重复 ID"); }
  return createProviderRegistry(plugins);
}
