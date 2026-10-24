import { useEffect, useState } from "react";
import { request, subscribe } from "../client";
import type { PageActivity, PageActivityItem } from "../core/page-activity";
import type { TargetTab } from "../core/protocol";
const labels: Record<PageActivityItem["state"], string> = { active: "持续生效", running: "执行中", unknown: "状态未知", failed: "最近运行失败", disabled: "已禁用", permission: "等待脚本权限", ready: "等待页面触发", manual: "等待手动运行", succeeded: "已完成 · 无持续实例" };
export function PageActivityPanel({ targets, targetId, onTargetChange, onSelect, onError }: {
  targets: TargetTab[]; targetId?: number; onTargetChange: (id: number) => void; onSelect: (id: string) => void; onError: (text: string) => void;
}) {
  const [activity, setActivity] = useState<PageActivity>(), [failure, setFailure] = useState(false), [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let disposed = false, sequence = 0;
    const refresh = () => {
      const ticket = ++sequence;
      void request<PageActivity>("pageActivity", { tabId: targetId }).then(value => { if (!disposed && ticket === sequence) { setActivity(value); setFailure(false); } }, () => { if (!disposed && ticket === sequence) { setActivity(undefined); setFailure(true); } });
    };
    setActivity(undefined); refresh();
    const unsubscribe = subscribe(event => { if (event.type === "targets" || (event.type === "database" && event.activityChanged !== false)) refresh(); });
    return () => { disposed = true; unsubscribe(); };
  }, [targetId]);
  const activeCount = activity?.items.filter(item => ["active", "running"].includes(item.state)).length ?? 0;
  return <section className="page-activity" aria-label="当前页面生效面板">
    <button className="page-activity-heading" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><strong>当前页面</strong><span>{activeCount} 生效 · {activity?.items.filter(item => item.matched).length ?? 0} 匹配</span><span>{expanded ? "收起" : "展开"}</span></button>
    {expanded && <div className="page-activity-content"><label>查看页面<select aria-label="生效面板目标页面" value={targetId ?? ""} onChange={event => onTargetChange(Number(event.target.value))}><option value="" disabled>请选择网页</option>{targets.map(tab => <option key={tab.id} value={tab.id}>{tab.title || tab.url}</option>)}</select></label>
      {!activity?.available && <p>{failure ? "页面状态读取失败，请重新打开面板。" : activity ? "暂无可访问的目标文档，请打开普通网页。" : "正在核对目标文档…"}</p>}
      {activity?.available && !activity.items.length && <p>当前页面没有匹配的已安装微应用或临时实例。</p>}
      {activity?.items.map(item => <article key={item.id} data-app-id={item.id}>
        <button className="activity-app-link" onClick={() => onSelect(item.id)}>{item.title}</button>
        <small>{labels[item.state]} · {item.installed ? "已安装" : "临时试用"} · {item.matched ? "匹配页面" : "不匹配"}</small>
        <small>当前版本 {item.revisionId.slice(0, 8)}{item.runRevisionId ? ` · 运行版本 ${item.runRevisionId.slice(0, 8)}` : ""}</small>
        {item.runId && <button className="secondary" onClick={() => { void request("stop", { runId: item.runId }).catch(error => onError(String(error))); }}>停止此实例</button>}
      </article>)}
      <small>匹配不等于运行。停止实例不会撤销已完成的业务操作。</small>
    </div>}
  </section>;
}
