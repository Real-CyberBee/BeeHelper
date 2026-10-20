import capabilities from "../../shared/capabilities.json";
import { current, type Database, type Run } from "./model";
import type { TargetTab } from "./protocol";

interface Selection { selectedAppId?: string; revisionId?: string; targetTabId?: number; hasUnsavedChanges?: boolean }
export function summarizeRun(run: Run) {
  return { runId: run.id, appId: run.appId, revisionId: run.revisionId, title: run.title, tabId: run.tabId ?? null, status: run.status, startedAt: run.startedAt, logCount: run.logs.length, hasErrors: run.logs.some(log => log.level === "error") };
}
export function buildAgentContext(db: Database, selection: Selection = {}, tabs: TargetTab[] = []) {
  const entry = db.entries.find(item => item.id === selection.selectedAppId);
  const revision = entry ? current(entry) : undefined;
  const target = tabs.find(tab => tab.id === selection.targetTabId);
  const runs = db.runs.filter(run => entry ? run.appId === entry.id : target ? run.tabId === target.id : false).slice(0, 5);
  return {
    capabilities,
    selectedApp: entry && revision ? {
      id: entry.id, revisionId: revision.id, selectedRevisionId: selection.revisionId ?? revision.id,
      installed: entry.installed, title: revision.definition.title, description: revision.definition.description,
      kind: revision.definition.kind, matches: revision.definition.matches, trigger: revision.definition.trigger
    } : null,
    hasUnsavedChanges: Boolean(selection.hasUnsavedChanges),
    targetPage: target ? { tabId: target.id, title: target.title, url: target.url } : null,
    targetUnavailable: selection.targetTabId !== undefined && !target,
    recentRuns: runs.map(summarizeRun)
  };
}
export function listRuns(db: Database, query: { appId?: string; tabId?: number; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(50, query.limit ?? 10));
  return db.runs.filter(run => (!query.appId || run.appId === query.appId) && (query.tabId === undefined || run.tabId === query.tabId)).slice(0, limit).map(summarizeRun);
}
export function getRun(db: Database, query: { runId?: string; id?: string }) {
  if (query.runId && query.id && query.runId !== query.id) throw new Error("runId 与兼容参数 id 不一致，请只传完整 runId");
  const id = (query.runId ?? query.id ?? "").trim();
  if (!id) throw new Error("缺少完整 runId；请从 microapp_run 返回值或 run_list 获取");
  if (/…|\.{3}/.test(id)) throw new Error("不能使用缩略 runId；请调用 run_list 获取完整运行 ID");
  const run = db.runs.find(item => item.id === id);
  if (!run) {
    if (db.entries.some(entry => entry.id === id)) throw new Error("收到的是微应用 ID，不是 runId；请调用 run_list({appId}) 获取运行记录");
    throw new Error("运行记录不存在或已超出最近 100 条的保留范围；请用 run_list 获取完整 runId，不能据此断言微应用没有执行");
  }
  return { ...structuredClone(run), runId: run.id };
}
