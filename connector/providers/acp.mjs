import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { spawnAgent } from "../process.mjs";
import { normalizeCommands, normalizeOptions, verifyOption, verifyCommand, acpContent } from "../content.mjs";

export function normalizeConfig(options = []) {
  const option = options.find(item => item.category === "model" || item.id === "model");
  const values = (option?.options ?? []).flatMap(item => item.options ?? [item]);
  return { modelConfigId: option?.id, appliedModel: option?.currentValue ?? "", models: values.map(item => ({ id: item.value, name: item.name })) };
}
export function createAcpAdapter({ launch, workspace, mcp, emit, permission, onExit, version }) {
  let child, connection, nativeSessionId, init, config = normalizeConfig(), configOptions = [], commands = [], closing = false, active = false;
  const metadata = () => ({
    nativeSessionId, models: config.models, appliedModel: config.appliedModel,
    commands, configOptions,
    capabilities: { models: Boolean(config.modelConfigId), steer: Boolean(init?._meta?.steering?.supported), resume: Boolean(init?.agentCapabilities?.loadSession || init?.agentCapabilities?.sessionCapabilities?.resume), tools: true, images: Boolean(init?.agentCapabilities?.promptCapabilities?.image), files: true, commands: commands.length > 0, config: configOptions.length > 0, skills: false }
  });
  const updateConfig = options => { config = normalizeConfig(options); configOptions = normalizeOptions(options); if (nativeSessionId) emit({ type: "session", ...metadata() }); };
  const timed = async (promise, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`ACP ${label}超时`)), 45_000); })]); }
    finally { clearTimeout(timer); }
  };
  return {
    async connect(id) {
      child = spawnAgent(launch, { cwd: workspace });
      child.stderr.resume();
      child.once("error", error => { if (!closing) onExit(error); });
      child.once("exit", code => { if (!closing) onExit(new Error(`ACP 进程已结束（${code}）；请检查客户端配置与运行时`)); });
      connection = acp.client({ name: "beehelper" })
        .onRequest(acp.methods.client.session.requestPermission, async ctx => {
          const request = ctx.params;
          if (nativeSessionId && request.sessionId !== nativeSessionId) return { outcome: { outcome: "cancelled" } };
          const selected = await permission({ title: request.toolCall?.title ?? "Agent 请求授权", options: request.options.map(option => ({ id: option.optionId, name: option.name })) });
          return { outcome: selected ? { outcome: "selected", optionId: selected } : { outcome: "cancelled" } };
        })
        .onNotification(acp.methods.client.session.update, ctx => {
          const { sessionId, update } = ctx.params;
          if (nativeSessionId && sessionId !== nativeSessionId) return;
          if (active && update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") emit({ type: "delta", messageId: this.messageId, text: update.content.text });
          if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") emit({ type: "tool", toolCallId: update.toolCallId, title: update.title, status: update.status, message: `${update.title ?? update.toolCallId} · ${update.status ?? "更新"}` });
          if (update.sessionUpdate === "config_option_update") updateConfig(update.configOptions);
          if (update.sessionUpdate === "available_commands_update") { commands = normalizeCommands(update.availableCommands); if (nativeSessionId) emit({ type: "session", ...metadata() }); }
        })
        .connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
      connection.closed.then(() => { if (!closing) onExit(new Error("ACP 连接已关闭")); }).catch(() => {});
      init = await timed(connection.agent.request("initialize", { protocolVersion: 1, clientInfo: { name: "beehelper", version }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }), "初始化");
      const mcpServers = [{ name: "beehelper", command: mcp.command, args: mcp.args, env: Object.entries(mcp.env).map(([name, value]) => ({ name, value })) }];
      let result;
      if (id) {
        const method = init.agentCapabilities?.sessionCapabilities?.resume ? "session/resume" : init.agentCapabilities?.loadSession ? "session/load" : undefined;
        if (!method) throw new Error("此 Agent 不支持恢复既有会话；历史仍保留，请新建会话");
        result = await timed(connection.agent.request(method, { sessionId: id, cwd: workspace, mcpServers }), "恢复会话");
      } else result = await timed(connection.agent.request("session/new", { cwd: workspace, mcpServers }), "创建会话");
      nativeSessionId = result.sessionId ?? id;
      config = normalizeConfig(result.configOptions);
      configOptions = normalizeOptions(result.configOptions);
      return metadata();
    },
    async setConfig(id, value) {
      verifyOption(configOptions, id, value);
      const result = await timed(connection.agent.request("session/set_config_option", { sessionId: nativeSessionId, configId: id, value }), "修改配置");
      if (result.configOptions) updateConfig(result.configOptions);
      if (configOptions.find(option => option.id === id)?.currentValue !== value) throw new Error("客户端未确认配置修改");
      return metadata();
    },
    async refresh() { return metadata(); },
    async setModel(model) {
      if (!config.modelConfigId || !config.models.some(item => item.id === model)) throw new Error("此 Agent 未提供该模型选项");
      return this.setConfig(config.modelConfigId, model);
    },
    async prompt(task) {
      if (active) throw new Error("当前会话正在运行");
      verifyCommand(task, commands);
      if (task.model && task.model !== config.appliedModel) await this.setModel(task.model);
      for (const [id, value] of Object.entries(task.config ?? {})) if (configOptions.find(option => option.id === id)?.currentValue !== value) await this.setConfig(id, value);
      const prompt = acpContent(task, init?.agentCapabilities?.promptCapabilities ?? {});
      active = true; this.messageId = `assistant:${task.messageId}`;
      try {
        const result = connection.agent.request("session/prompt", { sessionId: nativeSessionId, prompt });
        emit({ type: "delivery", messageId: task.messageId, status: "sent" });
        const response = await result;
        return response.stopReason === "cancelled" ? "interrupted" : response.stopReason === "end_turn" ? "completed" : "failed";
      } finally { active = false; }
    },
    async steer(task) {
      if (!active || !metadata().capabilities.steer) throw new Error("当前 Agent 未声明支持插话，或本轮已结束；可改为排队");
      if (task.command) throw new Error("客户端命令请排队执行，不作为插话投递");
      const result = await timed(connection.agent.request("_session/steering", { sessionId: nativeSessionId, prompt: acpContent(task, init?.agentCapabilities?.promptCapabilities ?? {}), _meta: { steering: { idleBehavior: "promptRequired" } } }), "插话");
      if (result?.outcome !== "injected") throw new Error("当前轮未确认插话；请核实会话状态后再发送，不要盲目重试");
      emit({ type: "delivery", messageId: task.messageId, status: "sent" });
    },
    async cancel() { await connection.agent.notify("session/cancel", { sessionId: nativeSessionId }); },
    close() {
      closing = true; connection?.close(); child?.kill("SIGTERM");
      if (child) { const timer = setTimeout(() => child.kill("SIGKILL"), 1000); timer.unref(); }
    }
  };
}
