import type { AgentCommand } from "./chat-content";

export const clientCommands = [
  { name: "new", description: "新建当前客户端的会话" },
  { name: "stop", description: "停止当前任务并暂停队列" },
  { name: "model", description: "选择当前会话模型" },
  { name: "skills", description: "选择客户端技能" },
  { name: "status", description: "查看当前会话状态" },
  { name: "help", description: "查看当前可用命令" }
];
export function localCommand(name: string, native: AgentCommand[] = []) {
  if (!name.startsWith("bee:") && native.some(command => command.name === name)) return;
  const short = name.startsWith("bee:") ? name.slice(4) : name;
  return clientCommands.find(command => command.name === short)?.name;
}
export function availableClientCommands(native: AgentCommand[] = []) {
  return clientCommands.map(command => ({ ...command, name: native.some(item => item.name === command.name) ? `bee:${command.name}` : command.name }));
}
