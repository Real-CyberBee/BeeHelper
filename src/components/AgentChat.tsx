import { useEffect, useRef, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Check, ChevronDown, Download, Info, MessageSquare, Pencil, Plug, Plus, Search, Send, Trash2, X, LoaderCircle } from "lucide-react";
import type { Database } from "../core/model";
import { activeSession, sessionBusy, type AgentProvider, type DeliveryMode } from "../core/sessions";
import { extensionMode, request } from "../client";
import { useChatDrafts } from "../agents/use-chat-drafts";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import { commandToken } from "../core/chat-content";
import type { ChatMessage as Message } from "../core/model";

const labels: Record<string, string> = { idle: "就绪", connecting: "连接中", running: "运行中", stopping: "停止中", disconnected: "未连接", unknown: "结果未知" };
interface Props {
  database: Database; providers: AgentProvider[];
  context: Record<string, unknown>; refresh: () => Promise<void>; onError: (message: string) => void;
  contextLabel?: string;
}
export function AgentChat({ database, providers, context, contextLabel, refresh, onError }: Props) {
  const session = activeSession(database);
  const drafts = useChatDrafts(session, onError);
  const [providerId, setProviderId] = useState("codex");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [mode, setMode] = useState<DeliveryMode>("queue");
  const [pending, setPending] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [showSearch, setShowSearch] = useState(false), [messageSearch, setMessageSearch] = useState(""), [statusOpen, setStatusOpen] = useState(false), [following, setFollowing] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const composer = useRef<ChatComposerHandle>(null);
  const busy = sessionBusy(session);
  const name = providers.find(item => item.id === session?.providerId)?.name ?? (session?.providerId === "codex" ? "Codex" : session?.providerId ?? "Agent");
  const visibleMessages = (session?.messages ?? []).filter(message => `${message.text} ${message.attachments?.map(item => item.name).join(" ") ?? ""}`.toLowerCase().includes(messageSearch.toLowerCase()));
  const action = async (operation: () => Promise<unknown>) => {
    setPending(true); onError("");
    try { await operation(); await refresh(); return true; }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); return false; }
    finally { setPending(false); }
  };
  useEffect(() => { if (following) end.current?.scrollIntoView({ block: "end" }); }, [session?.id, session?.messages.at(-1)?.text, session?.messages.length, following]);
  useEffect(() => { setMode("queue"); }, [session?.id, session?.capabilities.steer]);
  useEffect(() => { setFollowing(true); setShowSearch(false); setMessageSearch(""); }, [session?.id]);
  async function send() {
    if (!session || pending || !extensionMode || ["unknown", "stopping"].includes(session.state)) return;
    const id = session.id, snapshot = structuredClone(drafts.get(session.id));
    if (!snapshot.text.trim() && !snapshot.attachments.length && !snapshot.references.length) return;
    await action(async () => {
      await drafts.flush(id);
      const delivery = commandToken(snapshot.text) ? "queue" : busy ? mode : "queue";
      if (commandToken(snapshot.text)) setMode("queue");
      await request("chat", { sessionId: id, text: snapshot.text, attachments: snapshot.attachments, references: snapshot.references, mode: delivery, context });
      drafts.clearIfUnchanged(id, snapshot); setFollowing(true);
    });
  }
  function reuse(message: Message) {
    if (!session) return;
    const existing = drafts.get(session.id);
    if ((existing.text || existing.attachments.length || existing.references.length) && !confirm("替换当前草稿？")) return;
    drafts.update(session.id, { text: message.text, attachments: message.attachments ?? [], references: message.references ?? [] }, true);
  }
  function exportConversation() {
    if (!session) return;
    const blob = new Blob([JSON.stringify({ format: "beehelper.conversation", version: 1, title: session.title, provider: session.providerId, messages: session.messages }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${session.title.replace(/[^\p{L}\p{N}_.-]/gu, "_").slice(0, 80)}.beechat.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  async function answerPermission(optionId?: string) {
    if (!session?.permission || answering) return;
    setAnswering(true);
    try { await request("sessionPermission", { sessionId: session.id, requestId: session.permission.id, optionId }); await refresh(); }
    catch (error) { onError(String(error)); }
    finally { setAnswering(false); }
  }
  return <aside className="chat" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void composer.current?.addFiles([...event.dataTransfer.files]); } }}>
    <div className="chat-heading">
      <h2><MessageSquare size={17} />AI 会话</h2>
      <div className="session-create">
        <select aria-label="新会话客户端" value={providerId} onChange={event => setProviderId(event.target.value)}>
          {(providers.length ? providers : [{ id: "codex", name: "Codex", available: true }]).map(provider => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.name}{!provider.available ? " · 未就绪" : ""}</option>)}
        </select>
        <button type="button" className="icon-button" aria-label="新对话" title="新对话" disabled={pending} onClick={() => { void action(() => request("sessionNew", { providerId })); }}><Plus size={17} /></button>
      </div>
    </div>
    <details className="session-history" open>
      <summary>会话 <span>{database.sessions?.filter(item => !item.archived).length ?? 0}</span><ChevronDown size={13} /></summary>
      <div className="session-search"><Search size={13} /><input aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={event => setSearch(event.target.value)} /><label><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />归档</label></div>
      <div className="session-list">
        {database.sessions?.filter(item => Boolean(item.archived) === archived && item.title.toLowerCase().includes(search.toLowerCase())).map(item => <div key={item.id} className={`session-row ${session?.id === item.id ? "selected" : ""}`}>
          <button type="button" className="session-choice" aria-label={`切换会话：${item.title}`} disabled={item.archived} onClick={() => { void action(() => request("sessionSelect", { sessionId: item.id })); }}>
            <strong>{item.title}</strong><small>{providers.find(provider => provider.id === item.providerId)?.name ?? item.providerId} · {item.permission ? "等待授权" : labels[item.state]}</small>
          </button>
          {item.archived ? <button type="button" className="icon-button" title="恢复归档" aria-label={`恢复归档：${item.title}`} onClick={() => { void action(() => request("sessionArchive", { sessionId: item.id, archived: false })); }}><ArrowUp size={14} /></button> : <>
            <button type="button" className="icon-button" title="重命名会话" aria-label={`重命名会话：${item.title}`} onClick={() => {
              const title = window.prompt("会话名称", item.title);
              if (title?.trim()) void action(() => request("sessionRename", { sessionId: item.id, title }));
            }}><Pencil size={13} /></button>
            <button type="button" className="icon-button" title="归档会话" aria-label={`归档会话：${item.title}`} disabled={sessionBusy(item) || item.queue.length > 0} onClick={() => { void action(() => request("sessionArchive", { sessionId: item.id, archived: true })); }}><Archive size={13} /></button>
          </>}
        </div>)}
      </div>
    </details>
    {session && <>
      <div className="chat-context">
        <span className={`status-dot ${["disconnected", "unknown"].includes(session.state) ? "offline" : ""}`} /><span title={session.title}>{name} · {labels[session.state]}</span>
        <button type="button" className="icon-button" title="搜索消息" aria-label="搜索消息" onClick={() => { setShowSearch(!showSearch); if (showSearch) { setMessageSearch(""); setFollowing(true); } }}><Search size={14} /></button>
        <button type="button" className="icon-button" title="导出会话" aria-label="导出会话" onClick={exportConversation}><Download size={14} /></button>
        <button type="button" className="icon-button" title="会话状态" aria-label="会话状态" onClick={() => setStatusOpen(true)}><Info size={14} /></button>
        <button type="button" className="icon-button" title="连接或恢复会话" aria-label="连接或恢复会话" disabled={pending || busy || !extensionMode} onClick={() => { void action(() => request("connect", { sessionId: session.id })); }}><Plug size={14} /></button>
      </div>
      <div className="chat-target"><span>{contextLabel ?? "本地工作空间"}</span>{typeof context.targetTabId === "number" && <small>网页 #{context.targetTabId}</small>}</div>
      {showSearch && <div className="message-search"><Search size={13} /><input autoFocus aria-label="搜索当前会话消息" value={messageSearch} onChange={event => { setMessageSearch(event.target.value); setFollowing(false); }} /><span>{visibleMessages.length}</span><button type="button" className="icon-button" title="关闭消息搜索" aria-label="关闭消息搜索" onClick={() => { setShowSearch(false); setMessageSearch(""); setFollowing(true); }}><X size={13} /></button></div>}
      <div className="messages" role="region" aria-label="会话消息" onScroll={event => { const element = event.currentTarget; setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 80); }}>
        {!session.messages.length && <div className="chat-empty"><span className="agent-mark"><MessageSquare size={25} /></span><h3>新的对话</h3><span className="muted">{name} · {labels[session.state]}</span></div>}
        {visibleMessages.map(message => <ChatMessage key={message.id} message={message} agent={name} sessionId={session.id} onReuse={reuse} onError={onError} />)}
        {session.error && <div className="session-error" role="status">{session.error}</div>}
        {busy && <div className="working"><LoaderCircle size={14} className="spin" />{name} · {labels[session.state]}</div>}
        <div ref={end} />
      </div>
      {!following && <div className="scroll-latest"><button type="button" className="icon-button" title="回到最新消息" aria-label="回到最新消息" onClick={() => { setMessageSearch(""); setFollowing(true); }}><ArrowDown size={15} /></button></div>}
      {session.permission && <section className="permission-request" aria-label="Agent 授权请求">
        <strong>{session.permission.title}</strong>
        <div>{session.permission.options.map(option => <button type="button" key={option.id} className="secondary" disabled={answering} onClick={() => { void answerPermission(option.id); }}><Check size={13} />{option.name}</button>)}
          <button type="button" className="icon-button" title="取消授权" aria-label="取消授权" disabled={answering} onClick={() => { void answerPermission(); }}><X size={14} /></button></div>
      </section>}
      {session.queue.length > 0 && <section className="prompt-queue" aria-label="待发送队列">
        <div className="queue-heading"><span>队列 {session.queue.length}{session.queuePaused ? " · 已暂停" : ""}</span>
          {session.queuePaused && <button type="button" className="icon-button" title="继续队列" aria-label="继续队列" disabled={session.state !== "idle" || pending} onClick={() => { void action(() => request("queueResume", { sessionId: session.id })); }}><Send size={13} /></button>}
        </div>
        <div className="queue-list">{session.queue.map(item => <div className="queue-row" key={item.id}><span>{item.text}</span>
          <button type="button" className="icon-button" title="取回编辑" aria-label="取回编辑" disabled={pending} onClick={() => {
            const existing = drafts.get(session.id);
            if ((existing.text || existing.attachments.length || existing.references.length) && !confirm("替换当前草稿？")) return;
            void action(async () => { await request("queueRemove", { sessionId: session.id, messageId: item.id }); drafts.update(session.id, { text: item.text, attachments: item.attachments ?? [], references: item.references ?? [] }, true); });
          }}><Pencil size={13} /></button>
          <button type="button" className="icon-button" title="删除排队消息" aria-label="删除排队消息" disabled={pending} onClick={() => { void action(() => request("queueRemove", { sessionId: session.id, messageId: item.id })); }}><Trash2 size={13} /></button>
        </div>)}</div>
      </section>}
      <ChatComposer ref={composer} session={session} database={database} name={name} draft={drafts.draft} pending={pending} update={drafts.update} onSend={send} mode={mode} setMode={setMode} onAction={action} onLocalCommand={async command => {
        if (command === "new") return action(() => request("sessionNew", { providerId: session.providerId }));
        if (command === "stop") return action(() => request("cancel", { sessionId: session.id }));
        if (command === "status") { setStatusOpen(true); return true; }
        return false;
      }} onError={onError} />
      {statusOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setStatusOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-label="当前会话状态"><div className="modal-heading"><h2>会话状态</h2><button type="button" autoFocus className="icon-button" title="关闭会话状态" aria-label="关闭会话状态" onClick={() => setStatusOpen(false)}><X size={17} /></button></div>
        <div className="setting-row"><span>客户端</span><strong>{name}</strong></div><div className="setting-row"><span>状态</span><strong>{labels[session.state]}</strong></div><div className="setting-row"><span>当前模型</span><strong>{session.appliedModel || "未确认"}</strong></div>
        {session.model && <div className="setting-row"><span>下一轮模型</span><strong>{session.model}</strong></div>}
        <div className="setting-row"><span>原生会话</span><code>{session.nativeSessionId || "尚未创建"}</code></div>
        <div className="setting-row"><span>消息 / 队列</span><strong>{session.messages.length} / {session.queue.length}</strong></div>
        <div className="setting-row"><span>客户端命令 / 技能</span><strong>{session.commands?.length ?? 0} / {session.skills?.length ?? 0}</strong></div>
      </section></div>}
    </>}
  </aside>;
}
