import { useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Download, Info, MessageSquare, MoreHorizontal, PanelLeft, Pencil, Plug, Plus, Search, Send, Trash2, X, LoaderCircle } from "lucide-react";
import type { Database } from "../core/model";
import { activeSession, sessionBusy, type AgentProvider, type DeliveryMode } from "../core/sessions";
import { extensionMode, request } from "../client";
import { useChatDrafts } from "../agents/use-chat-drafts";
import { ChatComposer, type ChatComposerHandle } from "./ChatComposer";
import { ChatMessage } from "./ChatMessage";
import { SessionDrawer } from "./SessionDrawer";
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
  const usableProviders = providers.filter(provider => provider.available);
  const sessionProvider = session ? providers.find(provider => provider.id === session.providerId) : undefined;
  const sessionUnavailable = Boolean(session && providers.length > 0 && sessionProvider && !sessionProvider.available);
  const fallbackProvider = usableProviders[0];
  const [providerId, setProviderId] = useState("codex");
  const [historyOpen, setHistoryOpen] = useState(false), [toolsOpen, setToolsOpen] = useState(false);
  const tools = useRef<HTMLDivElement>(null);
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
  // 本机没有 Codex 时，新对话默认落到实际可用的客户端，而不是创建一个连不上的 Codex 会话。
  useEffect(() => {
    if (!providers.length) return;
    if (providers.some(provider => provider.id === providerId && provider.available)) return;
    const first = providers.find(provider => provider.available);
    if (first) setProviderId(first.id);
  }, [providers, providerId]);
  useEffect(() => { setMode("queue"); }, [session?.id, session?.capabilities.steer]);
  useEffect(() => { setFollowing(true); setShowSearch(false); setMessageSearch(""); }, [session?.id]);
  useEffect(() => { if (session) setProviderId(session.providerId); }, [session?.providerId]);
  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: PointerEvent) => { if (!tools.current?.contains(event.target as Node)) setToolsOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setToolsOpen(false); tools.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [toolsOpen]);
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
      <button type="button" className="icon-button" aria-label="打开会话列表" title="会话列表" aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)}><PanelLeft size={18} /></button>
      <div className="chat-heading-copy"><h2 title={session?.title}>{session?.title || "AI 会话"}</h2><span><i className={`status-dot ${["disconnected", "unknown"].includes(session?.state ?? "") ? "offline" : "online"}`} />{name} · {session?.permission ? "等待授权" : labels[session?.state ?? "disconnected"]}</span></div>
      <button type="button" className="icon-button" aria-label="新对话" title={providers.length > 0 && !usableProviders.length ? "没有可连接的本地客户端" : `新对话 · ${name}`} disabled={pending || (providers.length > 0 && !usableProviders.length)} onClick={() => { void action(() => request("sessionNew", { providerId })); }}><Plus size={18} /></button>
      {session && <div className="chat-tools" ref={tools} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setToolsOpen(false); }}>
        <button type="button" className="icon-button" title="更多会话操作" aria-label="更多会话操作" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}><MoreHorizontal size={18} /></button>
        {toolsOpen && <div className="chat-tools-menu" aria-label="会话操作">
          <div className="chat-target"><span title={contextLabel}>{contextLabel ?? "本地工作空间"}</span>{typeof context.targetTabId === "number" && <small>网页 #{context.targetTabId}</small>}</div>
          <button type="button" aria-label="搜索消息" onClick={() => { setShowSearch(true); setToolsOpen(false); }}><Search size={15} />搜索消息</button>
          <button type="button" aria-label="导出会话" onClick={() => { exportConversation(); setToolsOpen(false); }}><Download size={15} />导出会话</button>
          <button type="button" onClick={() => { setStatusOpen(true); setToolsOpen(false); }}><Info size={15} />会话状态</button>
          <button type="button" title={sessionUnavailable ? "当前客户端未就绪，请新建对话并选择其他客户端" : "连接或恢复会话"} aria-label="连接或恢复会话" disabled={pending || busy || !extensionMode || sessionUnavailable} onClick={() => { setToolsOpen(false); void action(() => request("connect", { sessionId: session.id })); }}><Plug size={15} />连接或恢复会话</button>
        </div>}
      </div>}
    </div>
    {historyOpen && <SessionDrawer database={database} providers={providers} providerId={providerId} pending={pending} labels={labels} onProviderChange={setProviderId} onAction={action} onClose={() => setHistoryOpen(false)} />}
    {session && <>
      {showSearch && <div className="message-search"><Search size={13} /><input autoFocus aria-label="搜索当前会话消息" value={messageSearch} onChange={event => { setMessageSearch(event.target.value); setFollowing(false); }} /><span>{visibleMessages.length}</span><button type="button" className="icon-button" title="关闭消息搜索" aria-label="关闭消息搜索" onClick={() => { setShowSearch(false); setMessageSearch(""); setFollowing(true); }}><X size={13} /></button></div>}
      <div className="messages" role="region" aria-label="会话消息" onScroll={event => { const element = event.currentTarget; setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 80); }}>
        {!session.messages.length && <div className="chat-empty"><span className="agent-mark"><MessageSquare size={25} /></span><h3>{sessionUnavailable ? `${name} 未就绪` : "新的对话"}</h3><span className="muted">{sessionUnavailable ? sessionProvider?.reason ?? "当前客户端未安装或未连接" : `${name} · ${labels[session.state]}`}</span>
          {sessionUnavailable && fallbackProvider && <button type="button" className="secondary" disabled={pending} onClick={() => { void action(async () => { const created = await request("sessionNew", { providerId: fallbackProvider.id }); await request("connect", { sessionId: created.id }); }); }}>改用 {fallbackProvider.name} 开始</button>}
        </div>}
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
