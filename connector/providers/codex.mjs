import { JsonRpcProcess } from "../process.mjs";
import { agentInstructions } from "../tools.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { codexContent, verifyCommand, verifyOption } from "../content.mjs";

export function createCodexAdapter({ launch, workspace, mcp, emit, permission, version, onExit }) {
  let rpc, nativeSessionId, turnId, completion, currentModel, models = [], authenticated = false, cliVersion;
  let skills = [], effort;
  const commands = [{ name: "compact", description: "压缩当前 Codex 会话上下文" }];
  const capabilities = { models: true, steer: true, resume: true, tools: true, images: true, files: true, commands: true, skills: true, config: true };
  async function readModels() {
    const catalog = []; let cursor;
    do {
      const result = await rpc.call("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      catalog.push(...result.data.map(model => ({ id: model.model, name: model.displayName ?? model.model, inputModalities: model.inputModalities, reasoningEfforts: (model.supportedReasoningEfforts ?? []).map(option => option.reasoningEffort), defaultEffort: model.defaultReasoningEffort })));
      cursor = result.nextCursor;
    } while (cursor);
    models = catalog;
  }
  async function readSkills(forceReload = false) {
    const result = await rpc.call("skills/list", { cwds: [workspace], forceReload });
    skills = (result.data ?? []).flatMap(entry => entry.skills ?? []).filter(skill => skill.enabled).slice(0, 200).map(skill => ({ id: createHash("sha256").update(skill.path).digest("hex").slice(0, 24), name: skill.name, path: skill.path, description: String(skill.shortDescription ?? skill.description ?? "").slice(0, 400), scope: skill.scope }));
    capabilities.skills = true;
  }
  function options() {
    const values = [...new Set(models.flatMap(model => model.reasoningEfforts ?? []))];
    return values.length ? [{ id: "effort", name: "推理强度", category: "thought_level", type: "select", currentValue: effort ?? "", options: values.map(value => ({ value, name: value })) }] : [];
  }
  function metadata() { return { nativeSessionId, models, commands, skills: skills.map(({ path, ...skill }) => skill), configOptions: options(), capabilities, authenticated, version: cliVersion, appliedModel: currentModel ?? "" }; }
  return {
    async connect(id) {
      // 临时工具凭据只进入子进程环境，不放在命令行参数或全局配置中。
      const envKeys = Object.keys(mcp.env).map(value => JSON.stringify(value)).join(",");
      const config = `mcp_servers={beehelper={command=${JSON.stringify(mcp.command)},args=[${mcp.args.map(value => JSON.stringify(value)).join(",")}],env_vars=[${envKeys}],required=true,default_tools_approval_mode="approve"}}`;
      rpc = new JsonRpcProcess({ ...launch, args: [...(launch.args ?? []), "app-server", "--listen", "stdio://", "-c", config] }, {
        cwd: workspace, env: mcp.env, onExit: error => { completion?.reject(error); onExit(error); },
        onRequest: async (method, params) => {
          if (!method.endsWith("/requestApproval")) throw new Error(`未支持的交互请求：${method}`);
          const selected = await permission({ title: params.reason ?? params.command ?? method, options: [{ id: "accept", name: "本次允许" }, { id: "decline", name: "拒绝" }] });
          return { decision: selected === "accept" ? "accept" : "decline" };
        },
        onNotification: (method, params) => {
          if (params.threadId && nativeSessionId && params.threadId !== nativeSessionId) return;
          if (method === "turn/started") {
            turnId = params.turn?.id; emit({ type: "state", state: "running", turnId });
          }
          if (method === "item/agentMessage/delta") emit({ type: "delta", messageId: params.itemId ?? `assistant:${params.turnId}`, text: params.delta });
          if (["item/started", "item/completed"].includes(method) && params.item?.type === "mcpToolCall") emit({ type: "tool", toolCallId: params.item.id, title: `${params.item.server}/${params.item.tool}`, status: params.item.status ?? "running", message: `${params.item.server}/${params.item.tool} · ${params.item.status ?? "running"}` });
          if (method === "error") emit({ type: "error", message: params.error?.message ?? "Codex 错误" });
          if (method === "turn/completed") {
            const pending = completion; completion = undefined; turnId = undefined;
            if (params.turn?.error) emit({ type: "error", message: params.turn.error.message ?? "Codex 执行失败" });
            pending?.resolve(params.turn?.status ?? "failed");
          }
        }
      });
      await rpc.call("initialize", { clientInfo: { name: "beehelper", title: "BeeHelper", version } });
      rpc.notify("initialized");
      const account = await rpc.call("account/read", { refreshToken: false });
      authenticated = Boolean(account.account);
      try { cliVersion = execFileSync(launch.command, [...(launch.args ?? []), "--version"], { encoding: "utf8", timeout: 5000 }).trim(); } catch { cliVersion = "Codex"; }
      const base = { cwd: workspace, developerInstructions: agentInstructions, approvalPolicy: "never", sandbox: "read-only" };
      const result = await rpc.call(id ? "thread/resume" : "thread/start", { ...base, ...(id ? { threadId: id } : {}) });
      nativeSessionId = result.thread.id; currentModel = result.model; effort = result.reasoningEffort ?? undefined;
      await readModels();
      try { await readSkills(); } catch { capabilities.skills = false; }
      return metadata();
    },
    async refresh() {
      await readModels(); await readSkills(true);
      emit({ type: "session", ...metadata() }); return metadata();
    },
    async setConfig(id, value) {
      verifyOption(options(), id, value);
      return { ...metadata(), nextTurn: true };
    },
    async setModel(model) {
      if (model && !models.some(item => item.id === model)) throw new Error("所选模型不在当前客户端可用列表中");
      return { ...metadata(), nextTurn: true };
    },
    async prompt(task) {
      if (completion) throw new Error("当前会话正在运行");
      verifyCommand(task, commands);
      const model = models.find(model => model.id === (task.model || currentModel));
      if (task.attachments?.some(item => item.kind === "image") && model?.inputModalities && !model.inputModalities.includes("image")) throw new Error("所选模型不支持图片输入，请更换模型");
      if (task.command && (task.text.trim() !== "/compact" || task.attachments?.length || task.references?.length)) throw new Error("/compact 不接受附加参数或附件");
      if (!task.command && task.config?.effort && !model?.reasoningEfforts?.includes(task.config.effort)) throw new Error("所选模型未声明该推理强度");
      const selectedEffort = task.config?.effort ?? (effort ? model?.reasoningEfforts?.includes(effort) ? effort : model?.defaultEffort : undefined);
      const input = task.command ? undefined : codexContent(task, skills);
      let resolve, reject;
      const done = new Promise((yes, no) => { resolve = yes; reject = no; });
      done.catch(() => {});
      completion = { resolve, reject };
      try {
        const result = task.command
          ? await rpc.call("thread/compact/start", { threadId: nativeSessionId })
          : await rpc.call("turn/start", { threadId: nativeSessionId, input, ...(task.model ? { model: task.model } : {}), ...(selectedEffort ? { effort: selectedEffort } : {}) });
        if (result.turn?.id) turnId = result.turn.id;
        if (!task.command) { if (task.model) currentModel = task.model; effort = selectedEffort; }
        emit({ type: "session", ...metadata() });
        emit({ type: "delivery", messageId: task.messageId, status: "sent" });
        const status = await done;
        if (task.command && status === "completed") emit({ type: "tool", message: "会话上下文压缩完成" });
        return status;
      } catch (error) { completion = undefined; throw error; }
    },
    async steer(task) {
      if (!turnId) throw new Error("当前轮已结束，未投递；请重新发送或加入队列");
      if (task.command) throw new Error("客户端命令请排队执行，不作为插话投递");
      const model = models.find(model => model.id === currentModel);
      if (task.attachments?.some(item => item.kind === "image") && model?.inputModalities && !model.inputModalities.includes("image")) throw new Error("当前轮模型不支持图片输入");
      await rpc.call("turn/steer", { threadId: nativeSessionId, expectedTurnId: turnId, input: codexContent(task, skills) });
      emit({ type: "delivery", messageId: task.messageId, status: "sent" });
    },
    async cancel() {
      if (!turnId) throw new Error("任务尚未获得轮次 ID，请稍后重试停止");
      await rpc.call("turn/interrupt", { threadId: nativeSessionId, turnId });
    },
    close() { completion?.reject(new Error("连接已关闭，执行结果可能未知")); completion = undefined; rpc?.close(); }
  };
}
