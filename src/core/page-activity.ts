import { current, matchesUrl, type Database } from "./model";

export interface LivePageInstance { appId: string; runId: string; tabId: number; revisionId: string; documentId?: string; url: string }
export interface PageActivityItem {
  id: string; title: string; installed: boolean; enabled: boolean; matched: boolean; revisionId: string;
  state: "active" | "running" | "unknown" | "failed" | "disabled" | "permission" | "ready" | "manual" | "succeeded";
  runId?: string; runRevisionId?: string;
}
export interface PageActivity { tabId?: number; documentId?: string; title?: string; url?: string; available: boolean; scriptsAvailable: boolean; items: PageActivityItem[] }

/** 历史记录只能表达结果；生效状态必须同时有同一文档的内存实例和运行状态。 */
export function pageActivity(db: Database, target: { tabId: number; documentId: string; url: string }, instances: LivePageInstance[], scriptsAvailable: boolean): PageActivityItem[] {
  return db.entries.flatMap(entry => {
    const definition = current(entry).definition;
    if (definition.kind !== "page") return [];
    const matched = definition.matches.some(pattern => matchesUrl(pattern, target.url));
    const live = instances.find(item => item.appId === entry.id && item.tabId === target.tabId && item.documentId === target.documentId && item.url === target.url);
    const run = live && db.runs.find(item => item.id === live.runId);
    if (!(entry.installed && matched) && !live) return [];
    const history = db.runs.find(item => item.appId === entry.id && item.tabId === target.tabId && item.documentId === target.documentId);
    const state: PageActivityItem["state"] = run && ["active", "running"].includes(run.status) ? run.status as "active" | "running"
      : !entry.enabled ? "disabled"
      : history && ["unknown", "failed", "succeeded"].includes(history.status) ? history.status as "unknown" | "failed" | "succeeded"
      : !scriptsAvailable ? "permission" : definition.trigger === "manual" ? "manual" : "ready";
    return [{ id: entry.id, title: definition.title, installed: entry.installed, enabled: entry.enabled, matched, revisionId: entry.revisionId,
      state, ...(run && ["active", "running"].includes(run.status) ? { runId: run.id, runRevisionId: run.revisionId } : {}) }];
  });
}
