import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Blocks, Search, Plus, Download, Upload, Star, Play, Square, Check, ArrowLeft, ChevronRight, Code2, List, History, MessageSquare, Settings2, ExternalLink, Trash2, RefreshCw, Send, Plug, X, Circle, FileCode2, Save, Copy, LoaderCircle, RotateCcw } from "lucide-react";
import { current, exportPackage, matchesUrl, type Database, type Definition, type Entry, type Run } from "./core/model";
import { panelSample } from "./core/samples";
import type { ConnectorStatus, TargetTab } from "./core/protocol";
import { extensionMode, request, subscribe } from "./client";
import "./style.css";

const stamp = (time: number) => new Date(time).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const short = (value: string) => value.slice(0, 8);
const stateLabels: Record<string, string> = { running: "执行中", active: "已激活", succeeded: "已完成", failed: "失败", stopped: "已停止", unknown: "结果未知" };
function IconButton({ title, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return <button {...props} type="button" className={`icon-button ${props.className ?? ""}`} title={title} aria-label={title}>{children}</button>;
}
type Preview = { runId: string; appId: string; revisionId: string; definition: Definition };
function PanelFrame({ preview }: { preview: Preview }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef(crypto.randomUUID());
  const sent = useRef(false);
  const send = useCallback(() => {
    if (sent.current || !frame.current?.contentWindow) return;
    sent.current = true;
    frame.current.contentWindow.postMessage({ channel: "bee:preview", type: "run", token: token.current, code: preview.definition.code }, "*");
  }, [preview]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "bee:sandbox") return;
      if (event.data.type === "ready") { send(); return; }
      if (event.data.token !== token.current) return;
      const { type, data } = event.data;
      if (type === "rpc") {
        void request(data.method === "capability" ? "panelCapability" : "panelStorage", { runId: preview.runId, method: data.method, ...data.args }).then(result => frame.current?.contentWindow?.postMessage({ channel: "bee:preview", type: "rpcResult", token: token.current, id: data.id, result }, "*"), error => frame.current?.contentWindow?.postMessage({ channel: "bee:preview", type: "rpcResult", token: token.current, id: data.id, error: String(error) }, "*"));
        return;
      }
      if (type === "complete") void request("panelEvent", { runId: preview.runId, status: data.resources ? "active" : "succeeded", text: data.value ?? "界面已就绪", level: "result" });
      else void request("panelEvent", { runId: preview.runId, text: String(data), level: type === "error" ? "error" : "info", ...(type === "error" ? { status: "failed" } : {}) });
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      void request("panelEvent", { runId: preview.runId, status: "stopped", text: "界面实例已关闭" }).catch(() => {});
    };
  }, [preview, send]);
  return <iframe ref={frame} title="微应用效果" className="preview-frame" sandbox="allow-scripts" src={extensionMode ? chrome.runtime.getURL("sandbox.html") : "/sandbox.html"} onLoad={() => { if (!sent.current) send(); }} />;
}
function App() {
  const [db, setDb] = useState<Database>();
  const [connector, setConnector] = useState<ConnectorStatus>({ connected: false });
  const [selectedId, setSelectedId] = useState<string>();
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("code");
  const [mobileView, setMobileView] = useState<"library" | "detail" | "chat">("library");
  const [editor, setEditor] = useState<{ id: string; base: string; definition: Definition }>();
  const [metadata, setMetadata] = useState(false);
  const [targets, setTargets] = useState<TargetTab[]>([]);
  const [targetId, setTargetId] = useState<number>();
  const [preview, setPreview] = useState<Preview>();
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState(false);
  const [models, setModels] = useState<{ model: string; displayName: string }[]>([]);
  const [model, setModel] = useState("");
  const [scriptsReady, setScriptsReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const selected = db?.entries.find(entry => entry.id === selectedId);
  const revision = selected ? current(selected) : undefined;
  const dirty = Boolean(editor && revision && JSON.stringify(editor.definition) !== JSON.stringify(selected?.revisions.find(item => item.id === editor.base)?.definition));
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;
  const latestRun = db?.runs.find(run => run.appId === selectedId);
  const refresh = useCallback(async () => {
    const result = await request<{ db: Database; connector: ConnectorStatus }>("state");
    setDb(result.db); setConnector(result.connector); setBusy(Boolean(result.connector.busy));
  }, []);
  const refreshTargets = useCallback(async () => { const tabs = await request<TargetTab[]>("tabs"); setTargets(tabs); setTargetId(current => tabs.some(tab => tab.id === current) ? current : tabs.find(tab => tab.active)?.id); }, []);
  useEffect(() => {
    void refresh().catch(error => setNotice(String(error)));
    void refreshTargets();
    void request("scriptsStatus").then(result => setScriptsReady(result.available));
    return subscribe(event => {
      if (event.type === "database") void refresh();
      if (event.type === "status") setConnector(event.status);
      if (event.type === "connector") { setConnector(event.status); if (!event.status.connected) setBusy(false); }
      if (event.type === "panelPreview") {
        if (dirtyRef.current && selectedRef.current !== event.appId) {
          setNotice("当前源码尚未保存，请保存后再打开新微应用的效果");
          void request("panelEvent", { runId: event.runId, status: "failed", level: "error", text: "工作台存在未保存源码，未切换预览" });
          return;
        }
        setPreview(event); setSelectedId(event.appId); setTab("result"); setMobileView("detail");
      }
      if (event.type === "stopPanel") setPreview(current => current?.runId === event.runId ? undefined : current);
      if (event.type === "busy") setBusy(event.value);
      if (event.type === "done") setBusy(false);
      if (event.type === "error") setNotice(event.message);
    });
  }, [refresh, refreshTargets]);
  useEffect(() => { if (!selectedId && db?.entries.length) setSelectedId(db.entries[0].id); }, [db, selectedId]);
  useEffect(() => {
    if (!selected || !revision) { setEditor(undefined); return; }
    if (editor?.id === selected.id && dirtyRef.current) return;
    setEditor({ id: selected.id, base: revision.id, definition: structuredClone(revision.definition) });
  }, [selectedId, revision?.id]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [db?.chat.at(-1)?.text]);
  const act = async <T,>(callback: () => Promise<T>): Promise<T | undefined> => {
    setPending(true); setNotice("");
    try { return await callback(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  async function operation(operation: unknown) { const result = await request<Entry>("operation", { operation }); await refresh(); return result; }
  async function saveEditor() {
    if (!editor) return;
    const result = await operation({ type: "edit", id: editor.id, expectedRevision: editor.base, definition: editor.definition });
    setEditor({ id: result.id, base: result.revisionId, definition: current(result).definition });
    return result;
  }
  async function runSelected() {
    if (!selected || !revision) return;
    const entry = dirty ? await saveEditor() : selected;
    if (!entry) return;
    await request("run", { id: entry.id, revisionId: entry.revisionId, tabId: targetId });
    setTab("result"); setMobileView("detail"); await refresh();
  }
  async function installSelected() {
    if (!selected || !revision) return;
    const entry = dirty ? await saveEditor() : selected;
    if (!entry) return;
    await operation({ type: "install", id: entry.id, revisionId: entry.revisionId });
    setScope("installed");
  }
  async function createApp() {
    if (dirty && !confirm("当前源码尚未保存，仍要新建吗？")) return;
    dirtyRef.current = false;
    const entry = await operation({ type: "create", definition: { ...panelSample, title: "新的微应用", description: "", code: 'bee.mount("<h2>新的微应用</h2>");' } });
    setSelectedId(entry.id); setMobileView("detail"); setScope("drafts"); setMetadata(true); setTab("code");
  }
  async function connectAgent() {
    const status = await request<ConnectorStatus>("connect"); setConnector(status);
    const result = await request("models"); setModels(result.data ?? []);
  }
  async function sendPrompt(event: React.FormEvent) {
    event.preventDefault();
    const text = prompt.trim(); if (!text || busy) return;
    setPrompt(""); setBusy(true); setNotice("");
    try {
      await request("chat", { text, model: model || undefined, context: { selectedAppId: selected?.id, revisionId: revision?.id, targetTabId: targetId, hasUnsavedChanges: dirty } });
      await refresh();
    } catch (error) { setBusy(false); setNotice(String(error)); setPrompt(text); }
  }
  function downloadApp(entry: Entry) {
    const url = URL.createObjectURL(new Blob([exportPackage(entry)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${current(entry).definition.title.replace(/[^\p{L}\p{N}_-]/gu, "_")}.beehelper.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function selectEntry(entry: Entry) {
    if (entry.id === selectedId) { setMobileView("detail"); return; }
    if (dirty && !confirm("当前源码尚未保存，仍要切换吗？")) return;
    dirtyRef.current = false; setEditor(undefined); setSelectedId(entry.id); setMobileView("detail"); setTab("code");
  }
  const entries = (db?.entries ?? []).filter(entry => (scope === "all" || (scope === "installed" ? entry.installed : scope === "drafts" ? !entry.installed : entry.favorite)) && `${current(entry).definition.title} ${current(entry).definition.description}`.toLowerCase().includes(search.toLowerCase()));
  if (!db) return <div className="loading"><LoaderCircle className="spin" /> BeeHelper</div>;
  const installedCount = db.entries.filter(entry => entry.installed).length;
  const candidateCount = db.entries.length - installedCount;
  return <div className={`shell view-${mobileView}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Blocks size={20} /></span><strong>BeeHelper</strong><span className="version">LOCAL</span></div>
      <div className="top-actions">
        <button className={`connection ${connector.ready ? "connected" : ""}`} onClick={() => { setSettings(true); }}><span className="status-dot" /> <span>Codex {connector.ready ? "已连接" : "未连接"}</span></button>
        {extensionMode && <IconButton title="在标签页打开" onClick={() => { void chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }); }}><ExternalLink size={16} /></IconButton>}
        <IconButton title="设置" onClick={() => setSettings(true)}><Settings2 size={17} /></IconButton>
      </div>
    </header>
    {notice && <div role="alert" className="notice"><span>{notice}</span><IconButton title="关闭提示" onClick={() => setNotice("")}><X size={15} /></IconButton></div>}
    <nav className="navigation">
      <div className="nav-label">工作空间</div>
      <button className={scope === "all" ? "nav-item selected" : "nav-item"} onClick={() => { setScope("all"); setMobileView("library"); }}><Blocks size={17} /><span>全部微应用</span><small>{db.entries.length}</small></button>
      <button className={scope === "installed" ? "nav-item selected" : "nav-item"} onClick={() => { setScope("installed"); setMobileView("library"); }}><Check size={17} /><span>已安装</span><small>{installedCount}</small></button>
      <button className={scope === "drafts" ? "nav-item selected" : "nav-item"} onClick={() => { setScope("drafts"); setMobileView("library"); }}><FileCode2 size={17} /><span>候选</span><small>{candidateCount}</small></button>
      <button className={scope === "favorites" ? "nav-item selected" : "nav-item"} onClick={() => { setScope("favorites"); setMobileView("library"); }}><Star size={17} /><span>收藏</span></button>
      <div className="nav-bottom"><span className="status-dot" /><span>本地工作空间</span></div>
    </nav>
    <section className="library">
      <div className="section-heading"><h1>微应用库</h1><div><IconButton title="导入微应用" onClick={() => fileInput.current?.click()}><Upload size={16} /></IconButton><IconButton title="新建微应用" onClick={() => { void act(createApp); }}><Plus size={18} /></IconButton></div></div>
      <div className="search-box"><Search size={15} /><input aria-label="搜索微应用" placeholder="搜索微应用" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="mobile-scopes">{[["all", "全部"], ["installed", "已安装"], ["drafts", "候选"], ["favorites", "收藏"]].map(([value, label]) => <button key={value} className={scope === value ? "active" : ""} onClick={() => setScope(value)}>{label}</button>)}</div>
      <div className="list-caption"><span>{scope === "installed" ? "已安装" : scope === "drafts" ? "候选微应用" : scope === "favorites" ? "收藏" : "全部微应用"}</span><span>{entries.length}</span></div>
      <div className="app-list">
        {entries.map(entry => {
          const item = current(entry).definition;
          return <button key={entry.id} className={`app-row ${entry.id === selectedId ? "selected" : ""}`} onClick={() => { void selectEntry(entry); }}>
            <span className={`app-icon ${item.kind}`}><>{item.kind === "page" ? <Code2 size={19} /> : <Blocks size={19} />}</></span>
            <span className="app-row-copy"><strong>{item.title}</strong><span>{item.description || "—"}</span><small>{entry.installed ? "已安装" : "候选"}<i />{item.kind === "page" ? "页面脚本" : "交互界面"}</small></span>
            {entry.favorite ? <Star size={13} className="star-filled" /> : <ChevronRight size={15} className="muted" />}
          </button>;
        })}
        {!entries.length && <div className="empty"><Blocks size={28} /><p>{search ? "没有匹配的微应用" : "暂无微应用"}</p><button className="text-button" onClick={() => { void act(createApp); }}>新建微应用</button></div>}
      </div>
      <div className="library-footer"><span>{installedCount} 已安装 · {candidateCount} 候选</span><IconButton title="刷新" onClick={() => { void refresh(); void refreshTargets(); }}><RefreshCw size={14} /></IconButton></div>
    </section>
    <main className="workspace">
      {selected && revision && editor ? <>
        <div className="detail-heading">
          <IconButton title="返回微应用库" className="mobile-back" onClick={() => setMobileView("library")}><ArrowLeft size={18} /></IconButton>
          <span className={`app-icon large ${revision.definition.kind}`}>{revision.definition.kind === "page" ? <Code2 size={24} /> : <Blocks size={24} />}</span>
          <div className="detail-title"><div><h2>{revision.definition.title}</h2><span className={`badge ${selected.installed ? "green" : "amber"}`}>{selected.installed ? "已安装" : "未安装"}</span></div><p>{revision.definition.description || "—"}</p></div>
          <IconButton title={selected.favorite ? "取消收藏" : "收藏"} onClick={() => { void act(() => operation({ type: "favorite", id: selected.id, value: !selected.favorite })); }}><Star size={18} className={selected.favorite ? "star-filled" : ""} /></IconButton>
        </div>
        <div className="app-actions">
          <button className="primary" disabled={pending} onClick={() => { void act(runSelected); }}><Play size={15} />查看效果</button>
          {!selected.installed && <button className="secondary" disabled={pending} onClick={() => { void act(installSelected); }}><Download size={15} />安装</button>}
          {selected.installed && <label className="enable-control"><input type="checkbox" checked={selected.enabled} onChange={event => { void act(() => operation({ type: "enable", id: selected.id, value: event.target.checked })); }} />启用</label>}
          <div className="action-spacer" />
          <IconButton title="编辑属性" onClick={() => setMetadata(!metadata)}><Settings2 size={16} /></IconButton>
          <IconButton title="导出微应用" onClick={() => { void act(async () => downloadApp(selected)); }}><Download size={16} /></IconButton>
          <IconButton title={selected.installed ? "卸载微应用" : "丢弃候选"} onClick={() => { if (confirm(selected.installed ? "卸载此微应用及其本地版本记录？" : "丢弃此候选？")) void act(async () => { await operation({ type: "delete", id: selected.id }); dirtyRef.current = false; setSelectedId(undefined); setPreview(undefined); }); }}><Trash2 size={16} /></IconButton>
        </div>
        {metadata && <div className="metadata">
          <label>名称<input aria-label="微应用名称" value={editor.definition.title} onChange={event => setEditor({ ...editor, definition: { ...editor.definition, title: event.target.value } })} /></label>
          <label>描述<input value={editor.definition.description} onChange={event => setEditor({ ...editor, definition: { ...editor.definition, description: event.target.value } })} /></label>
          <div className="metadata-pair"><label>类型<select value={editor.definition.kind} onChange={event => setEditor({ ...editor, definition: { ...editor.definition, kind: event.target.value as Definition["kind"], ...(event.target.value === "panel" ? { trigger: "manual" as const } : {}) } })}><option value="page">页面脚本</option><option value="panel">交互界面</option></select></label><label>触发<select value={editor.definition.trigger} onChange={event => setEditor({ ...editor, definition: { ...editor.definition, trigger: event.target.value as Definition["trigger"] } })}><option value="manual">主动运行</option><option value="page" disabled={editor.definition.kind === "panel"}>匹配页面自动激活</option></select></label></div>
          <label>匹配页面<textarea aria-label="匹配页面" rows={2} value={editor.definition.matches.join("\n")} onChange={event => setEditor({ ...editor, definition: { ...editor.definition, matches: event.target.value.split("\n") } })} /></label>
        </div>}
        {revision.definition.kind === "page" && <div className="target-row"><span className={`status-dot ${scriptsReady ? "" : "warning"}`} /><select aria-label="目标页面" value={targetId ?? ""} onChange={event => setTargetId(Number(event.target.value))}><option value="" disabled>选择目标页面</option>{targets.map(target => <option key={target.id} value={target.id}>{target.title || target.url}</option>)}</select><IconButton title="刷新目标页面" onClick={() => { void refreshTargets(); void request("scriptsStatus").then(result => setScriptsReady(result.available)); }}><RefreshCw size={14} /></IconButton></div>}
        <div className="view-tabs" role="tablist">{[["code", "源码", Code2], ["result", "效果与日志", List], ["versions", "版本", History]].map(([value, label, Icon]) => <button key={String(value)} role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => setTab(String(value))}>{React.createElement(Icon as typeof Code2, { size: 15 })}{String(label)}</button>)}<span className="revision-tag">v{selected.revisions.findIndex(item => item.id === revision.id) + 1}</span></div>
        <div className="detail-body">
          {tab === "code" && <div className="code-pane">
            <div className="code-toolbar"><span><FileCode2 size={14} /> main.js</span><span className={dirty ? "dirty" : "muted"}>{dirty ? "未保存" : short(editor.base)}</span><div className="action-spacer" /><IconButton title="复制源码" onClick={() => { void navigator.clipboard.writeText(editor.definition.code).catch(error => setNotice(String(error))); }}><Copy size={14} /></IconButton><button className="save-button" disabled={!dirty || pending} onClick={() => { void act(saveEditor); }}><Save size={14} />保存修改</button></div>
            {editor.base !== revision.id && <div className="conflict">已有新版本。<button onClick={() => setEditor({ id: selected.id, base: revision.id, definition: revision.definition })}>载入新版本</button></div>}
            <textarea aria-label="微应用源码" data-testid="code-editor" className="code-editor" spellCheck={false} value={editor.definition.code} onChange={event => setEditor({ ...editor, definition: { ...editor.definition, code: event.target.value } })} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); void act(saveEditor); } }} />
          </div>}
          <div className={tab === "result" ? "result-pane" : "result-pane hidden-pane"}>
            {preview?.appId === selected.id && <div className="live-preview"><div className="preview-heading"><span><Circle size={9} fill="currentColor" />实时效果</span><IconButton title="结束试用" onClick={() => { void act(() => request("stop", { runId: preview.runId })); }}><X size={15} /></IconButton></div><PanelFrame key={preview.runId} preview={preview} /></div>}
            <RunOutput run={latestRun} onStop={runId => { void act(() => request("stop", { runId })); }} />
          </div>
          {tab === "versions" && <div className="versions">{[...selected.revisions].reverse().map((item, index) => <div className="version-row" key={item.id}><span className="version-node" /><div><strong>v{selected.revisions.length - index} {item.id === revision.id && <span className="badge green">当前</span>}</strong><p>{stamp(item.createdAt)} · {item.source}</p><code>{short(item.id)}</code></div><div className="action-spacer" />{item.id !== revision.id && <IconButton title="恢复此版本" onClick={() => { void act(() => operation({ type: "restore", id: selected.id, revisionId: item.id, expectedRevision: revision.id })); }}><RotateCcw size={16} /></IconButton>}</div>)}</div>}
        </div>
        <footer className="workspace-footer"><span>{revision.definition.kind === "page" ? "JavaScript · 页面" : "JavaScript · 隔离界面"}</span><span>{selected.revisions.length} 个版本</span></footer>
      </> : <div className="empty"><Blocks size={32} /><p>选择一个微应用</p></div>}
    </main>
    <aside className="chat">
      <div className="chat-heading"><h2><MessageSquare size={17} />Codex</h2><IconButton title="新对话" disabled={busy} onClick={() => { void act(async () => { await request("newChat"); await refresh(); }); }}><Plus size={17} /></IconButton></div>
      <div className="chat-context"><span className="status-dot" /><span>{selected ? revision?.definition.title : "本地工作空间"}</span>{targetId && <small>网页 #{targetId}</small>}</div>
      <div className="messages">
        {!db.chat.length && <div className="chat-empty"><span className="agent-mark"><MessageSquare size={25} /></span><h3>新的对话</h3><span className="muted">Codex {connector.ready ? "已就绪" : "未连接"}</span></div>}
        {db.chat.map(message => <div key={message.id} className={`message ${message.role}`}><div className="message-label">{message.role === "user" ? "你" : message.role === "assistant" ? "Codex" : message.role === "tool" ? "工具" : "错误"}<time>{stamp(message.time)}</time></div><div>{message.text}</div></div>)}
        {busy && <div className="working"><LoaderCircle size={14} className="spin" />Codex 正在运行</div>}<div ref={chatEnd} />
      </div>
      <form className="composer" onSubmit={event => { void sendPrompt(event); }}>
        <textarea aria-label="发送给 Codex" placeholder="描述任务或想要修改的地方…" value={prompt} onChange={event => setPrompt(event.target.value)} rows={3} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void sendPrompt(event); } }} />
        <div className="composer-actions"><select aria-label="模型" value={model} onChange={event => setModel(event.target.value)}><option value="">Codex 默认模型</option>{models.map(item => <option key={item.model} value={item.model}>{item.displayName ?? item.model}</option>)}</select>{busy ? <IconButton title="停止 Codex" onClick={() => { void act(() => request("cancel")); }}><Square size={16} /></IconButton> : <button type="submit" className="send-button" disabled={!prompt.trim()} aria-label="发送"><Send size={16} /></button>}</div>
      </form>
    </aside>
    <nav className="mobile-nav"><button className={mobileView === "library" ? "active" : ""} onClick={() => setMobileView("library")}><Blocks size={18} />微应用</button><button className={mobileView === "detail" ? "active" : ""} disabled={!selected} onClick={() => setMobileView("detail")}><Code2 size={18} />工作台</button><button className={mobileView === "chat" ? "active" : ""} onClick={() => setMobileView("chat")}><MessageSquare size={18} />Codex{busy && <span className="status-dot" />}</button></nav>
    <input type="file" ref={fileInput} hidden accept=".json,application/json" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      if (dirty && !confirm("当前源码尚未保存，仍要导入并切换吗？")) return;
      dirtyRef.current = false;
      void act(async () => { if (file.size > 5_000_000) throw new Error("微应用包超过 5 MB"); const entry = await request<Entry>("import", { text: await file.text() }); await refresh(); setSelectedId(entry.id); setScope("drafts"); setMobileView("detail"); });
    }} />
    {settings && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettings(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="modal-heading"><h2 id="settings-title">本地连接</h2><IconButton title="关闭设置" onClick={() => setSettings(false)}><X size={18} /></IconButton></div><div className="setting-row"><span>运行环境</span><strong>{extensionMode ? "Chrome 扩展" : "网页预览"}</strong></div><div className="setting-row"><span>扩展标识</span><code>{extensionMode ? chrome.runtime.id : "—"}</code></div><div className="setting-row"><span>Codex</span><strong>{connector.version ?? (connector.ready ? "已就绪" : "未连接")}</strong></div>{connector.authenticated !== undefined && <div className="setting-row"><span>登录状态</span><strong>{connector.authenticated ? "已登录" : "未登录"}</strong></div>}<div className="setting-row"><span>页面脚本</span><strong>{scriptsReady ? "可用" : "未启用"}</strong></div>{connector.error && <div className="setting-error">{connector.error}</div>}<div className="modal-actions">{extensionMode && <button className="secondary" onClick={() => { void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }); }}>扩展详情<ExternalLink size={14} /></button>}<button className="primary" disabled={pending || !extensionMode} onClick={() => { void act(connectAgent); }}><Plug size={15} />{pending ? "连接中…" : connector.ready ? "检查连接" : "连接 Codex"}</button></div></section></div>}
  </div>;
}
function RunOutput({ run, onStop }: { run?: Run; onStop: (id: string) => void }) {
  if (!run) return <div className="empty compact"><Play size={24} /><p>尚无运行记录</p></div>;
  return <section className="run-output"><div className="run-heading"><span className={`badge ${run.status === "failed" ? "red" : run.status === "active" || run.status === "succeeded" ? "green" : ""}`}>{stateLabels[run.status]}</span><span>{run.trial ? "临时试用" : "已安装运行"} · {stamp(run.startedAt)}</span><div className="action-spacer" />{["active", "running"].includes(run.status) && <IconButton title="停止运行" onClick={() => onStop(run.id)}><Square size={14} /></IconButton>}</div><div className="run-meta">版本 {short(run.revisionId)}{run.tabId ? ` · 网页 #${run.tabId}` : ""}</div><div className="logs" role="log">{run.logs.map((log, index) => <div className={`log-row ${log.level}`} key={index}><time>{new Date(log.time).toLocaleTimeString("zh-CN", { hour12: false })}</time><pre>{log.text}</pre></div>)}</div></section>;
}
createRoot(document.getElementById("root")!).render(<App />);
