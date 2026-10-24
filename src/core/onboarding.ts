import type { AgentProvider } from "./sessions";
export interface SetupSnapshot {
  extension: boolean; version: string; scripts: boolean; connector: boolean;
  connectorVersion?: string; providers: AgentProvider[]; completed: boolean;
  issue?: "host-unavailable";
}
/** 可复制的诊断仅包含能力布尔值和发布版本，不导出 URL、机器路径、源码或会话。 */
export function diagnosticReport(snapshot: SetupSnapshot) {
  return { format: "beehelper.diagnostics", schemaVersion: 1, extension: snapshot.extension, version: snapshot.version,
    scripts: snapshot.scripts, connector: snapshot.connector, connectorVersion: snapshot.connectorVersion,
    providers: snapshot.providers.map(({ id, installed, available, protocol }) => ({ id, installed, available, protocol })), issue: snapshot.issue };
}
