import { useEffect, useRef, useState } from "react";
import { Archive, ArrowUp, Pencil, Plus, Search, X } from "lucide-react";
import type { Database } from "../core/model";
import { sessionBusy, type AgentProvider } from "../core/sessions";
import { request } from "../client";

interface Props {
  database: Database;
  providers: AgentProvider[];
  providerId: string;
  pending: boolean;
  labels: Record<string, string>;
  onProviderChange: (id: string) => void;
  onAction: (operation: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
}

export function SessionDrawer({ database, providers, providerId, pending, labels, onProviderChange, onAction, onClose }: Props) {
  const [search, setSearch] = useState(""), [archived, setArchived] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  const sessions = database.sessions?.filter(item => Boolean(item.archived) === archived && item.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <div className="session-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="session-drawer" role="dialog" aria-modal="true" aria-label="会话列表" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="drawer-heading"><h2>会话</h2><button type="button" className="icon-button" title="关闭会话列表" aria-label="关闭会话列表" onClick={onClose}><X size={18} /></button></div>
      <div className="session-search"><Search size={15} /><input aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={event => setSearch(event.target.value)} /><label><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />归档</label></div>
      <div className="drawer-create">
        <select aria-label="新会话客户端" value={providerId} onChange={event => onProviderChange(event.target.value)}>
          {(providers.length ? providers : [{ id: "codex", name: "Codex", available: true }]).map(provider => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.name}{!provider.available ? " · 未就绪" : ""}</option>)}
        </select>
        <button type="button" className="icon-button" title="创建会话" aria-label="创建会话" disabled={pending} onClick={() => { void onAction(() => request("sessionNew", { providerId })).then(ok => { if (ok) onClose(); }); }}><Plus size={18} /></button>
      </div>
      <div className="session-list">
        {!sessions.length && <div className="empty compact">{search ? "未找到会话" : archived ? "暂无归档会话" : "暂无会话"}</div>}
        {sessions.map(item => <div key={item.id} className={`session-row ${database.activeSessionId === item.id ? "selected" : ""}`}>
          <button type="button" className="session-choice" aria-label={`切换会话：${item.title}`} disabled={item.archived || pending} onClick={() => { void onAction(() => request("sessionSelect", { sessionId: item.id })).then(ok => { if (ok) onClose(); }); }}>
            <strong>{item.title}</strong><small>{providers.find(provider => provider.id === item.providerId)?.name ?? item.providerId} · {item.permission ? "等待授权" : labels[item.state]}</small>
          </button>
          {item.archived ? <button type="button" className="icon-button" title="恢复归档" aria-label={`恢复归档：${item.title}`} disabled={pending} onClick={() => { void onAction(() => request("sessionArchive", { sessionId: item.id, archived: false })); }}><ArrowUp size={14} /></button> : <>
            <button type="button" className="icon-button" title="重命名会话" aria-label={`重命名会话：${item.title}`} disabled={pending} onClick={() => {
              const title = window.prompt("会话名称", item.title);
              if (title?.trim()) void onAction(() => request("sessionRename", { sessionId: item.id, title }));
            }}><Pencil size={14} /></button>
            <button type="button" className="icon-button" title="归档会话" aria-label={`归档会话：${item.title}`} disabled={pending || sessionBusy(item) || item.queue.length > 0} onClick={() => { void onAction(() => request("sessionArchive", { sessionId: item.id, archived: true })); }}><Archive size={14} /></button>
          </>}
        </div>)}
      </div>
    </section>
  </div>;
}
