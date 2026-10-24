import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AtSign, FilePlus2, FileCode2, Globe, Paperclip, Send, Settings2, Slash, Square, X, LoaderCircle, Sparkles, Plug, RotateCcw, RefreshCw } from "lucide-react";
import type { Database } from "../core/model";
import { current } from "../core/model";
import { sessionBusy, type ChatSession, type DeliveryMode } from "../core/sessions";
import { completionToken, commandToken, contentLimits, type ChatDraft, type ChatReference } from "../core/chat-content";
import { availableClientCommands, localCommand } from "../core/chat-commands";
import type { TargetTab } from "../core/protocol";
import { extensionMode, request } from "../client";
import { uploadAttachment } from "../agents/attachment-client";
import { ChatAttachments } from "./ChatAttachments";

interface Props {
  session: ChatSession; database: Database; name: string; draft: ChatDraft; pending: boolean;
  update: (id: string, change: ChatDraft | ((draft: ChatDraft) => ChatDraft), immediate?: boolean) => void;
  onSend: () => Promise<void>; mode: DeliveryMode; setMode: (mode: DeliveryMode) => void;
  onAction: (operation: () => Promise<unknown>) => Promise<boolean>;
  onLocalCommand: (name: string) => Promise<boolean>; onError: (message: string) => void;
}
type Upload = { id: string; sessionId: string; file: File; progress: number; error?: string; controller: AbortController };
type Candidate = { id: string; label: string; description: string; kind: "command" | "reference" | "file" | "connect"; reference?: ChatReference; command?: string };
export interface ChatComposerHandle { addFiles: (files: File[]) => Promise<void> }
export const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer({ session, database, name, draft, pending, update, onSend, mode, setMode, onAction, onLocalCommand, onError }, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null), modelPicker = useRef<HTMLSelectElement>(null);
  const [cursor, setCursor] = useState(0), [manual, setManual] = useState<"command" | "reference" | "skill">();
  const [dismissed, setDismissed] = useState(false), [active, setActive] = useState(0), [tabs, setTabs] = useState<TargetTab[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]), [dragging, setDragging] = useState(false), [config, setConfig] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(() => localStorage.getItem("beehelper.enterSend") !== "false");
  const uploading = useRef(new Map<string, Upload>());
  const mounted = useRef(true);
  const busy = sessionBusy(session), token = completionToken(draft.text, cursor);
  const kind = manual === "skill" ? "reference" : manual ?? token?.kind;
  const query = manual ? "" : token?.query.toLowerCase() ?? "";
  const local = availableClientCommands(session.commands);
  const nativeNames = new Set(session.commands?.map(command => command.name));
  const commands: Candidate[] = [...(session.commands ?? []).map(command => ({ id: `native:${command.name}`, kind: "command" as const, label: `/${command.name}`, description: command.description, command: command.name })), ...local.map(command => ({ id: `bee:${command.name}`, kind: "command" as const, label: `/${command.name}`, description: command.description, command: command.name }))];
  const referenceItems: Candidate[] = manual === "skill" ? [] : [
    { id: "file", kind: "file", label: "选择本地文件", description: "文件" },
    ...database.entries.map(entry => ({ id: `app:${entry.id}`, kind: "reference" as const, label: current(entry).definition.title, description: `微应用 · ${entry.installed ? "已安装" : "候选"} · ${entry.id.slice(0, 8)}`, reference: { kind: "microapp" as const, id: entry.id, label: current(entry).definition.title } })),
    ...tabs.map(tab => ({ id: `page:${tab.id}`, kind: "reference" as const, label: tab.title || tab.url, description: `网页 #${tab.id} · ${tab.url}`, reference: { kind: "page" as const, id: String(tab.id), label: (tab.title || tab.url).slice(0, 250) } }))
  ];
  referenceItems.push(...(session.skills ?? []).map(skill => ({ id: `skill:${skill.id}`, kind: "reference" as const, label: skill.name, description: `技能${skill.scope ? ` · ${skill.scope}` : ""} · ${skill.description}`, reference: { kind: "skill" as const, id: skill.id, label: skill.name } })));
  const candidates = (kind === "command" ? commands : referenceItems).filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query)).slice(0, 30);
  if (kind && ["disconnected", "unknown"].includes(session.state)) candidates.unshift({ id: "connect", kind: "connect", label: "连接获取客户端目录", description: name });
  else if (kind && !query) candidates.push({ id: "refresh", kind: "connect", label: "同步客户端目录", description: name });
  const showMenu = Boolean(kind && !dismissed);
  const displayedUploads = uploads.filter(item => item.sessionId === session.id);
  const isUploading = displayedUploads.some(item => !item.error);
  const selectedModel = session.models.find(model => model.id === (session.model ?? session.appliedModel));
  const extraOptions = (session.configOptions ?? []).filter(option => option.category !== "model" && option.id !== "model").map(option =>
    option.id === "effort" && selectedModel?.reasoningEfforts ? { ...option, options: option.options?.filter(item => selectedModel.reasoningEfforts!.includes(item.value)) } : option);
  const menuId = `composer-menu-${session.id}`;
  useImperativeHandle(ref, () => ({ addFiles }));
  useEffect(() => { setManual(undefined); setDismissed(false); setConfig(false); setCursor(0); }, [session.id]);
  useEffect(() => { setActive(0); }, [query, kind, session.id]);
  useEffect(() => {
    if (kind !== "reference" || !extensionMode) return;
    let live = true; void request<TargetTab[]>("tabs").then(result => { if (live) setTabs(result); }).catch(() => {});
    return () => { live = false; };
  }, [kind, session.id]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "auto"; textarea.current.style.height = `${Math.min(160, Math.max(48, textarea.current.scrollHeight))}px`;
  }, [draft.text, session.id]);
  useEffect(() => {
    mounted.current = true;
    const abort = () => { for (const item of uploading.current.values()) item.controller.abort(); };
    window.addEventListener("pagehide", abort);
    return () => { mounted.current = false; abort(); window.removeEventListener("pagehide", abort); };
  }, []);
  function replaceToken(text: string) {
    const start = token?.start ?? (kind === "command" ? 0 : cursor);
    const end = token?.end ?? (kind === "command" ? 0 : cursor);
    const value = draft.text.slice(0, start) + text + draft.text.slice(end);
    update(session.id, { ...draft, text: value }); setCursor(start + text.length);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(start + text.length, start + text.length); });
  }
  function choose(item: Candidate) {
    if (item.kind === "connect") { void onAction(() => request("sessionCatalog", { sessionId: session.id })); return; }
    if (item.kind === "file") { picker.current?.click(); return; }
    if (item.kind === "command") { replaceToken(`/${item.command} `); setMode("queue"); }
    else if (item.reference) {
      const reference = item.reference;
      if (draft.references.length >= contentLimits.maxReferences && !draft.references.some(ref => ref.kind === reference.kind && ref.id === reference.id)) { onError(`每条消息最多 ${contentLimits.maxReferences} 个引用`); return; }
      replaceToken(`@${reference.label} `);
      update(session.id, value => ({ ...value, references: [...value.references.filter(ref => `${ref.kind}:${ref.id}` !== `${reference.kind}:${reference.id}`), reference] }));
    }
    setManual(undefined); setDismissed(true);
  }
  async function addFiles(files: File[]) {
    const id = session.id;
    if (!extensionMode) { onError("附件需要本地 Agent 连接器"); return; }
    const reserved = [...uploading.current.values()].filter(item => item.sessionId === id);
    if (files.length + draft.attachments.length + reserved.length > contentLimits.maxFiles) { onError(`每条消息最多 ${contentLimits.maxFiles} 个附件`); return; }
    if ([...files, ...reserved.map(item => item.file)].reduce((sum, file) => sum + file.size, draft.attachments.reduce((sum, file) => sum + file.size, 0)) > contentLimits.maxMessageFileBytes) { onError("附件总大小超过 32 MB"); return; }
    setManual(undefined); setDismissed(true);
    const batch = files.map(file => ({ id: crypto.randomUUID(), sessionId: id, file, progress: 0, controller: new AbortController() }));
    for (const upload of batch) uploading.current.set(upload.id, upload);
    setUploads(current => [...current, ...batch]);
    for (const upload of batch) {
      if (!mounted.current) return;
      const file = upload.file;
      try {
        const item = await uploadAttachment(file, id, progress => setUploads(current => current.map(item => item.id === upload.id ? { ...item, progress } : item)), upload.controller.signal);
        update(id, value => ({ ...value, attachments: [...value.attachments, item] }), true);
        setUploads(current => current.filter(item => item.id !== upload.id));
      } catch (error) {
        if ((error as Error).name === "AbortError") setUploads(current => current.filter(item => item.id !== upload.id));
        else setUploads(current => current.map(item => item.id === upload.id ? { ...item, error: String(error) } : item));
      } finally { uploading.current.delete(upload.id); }
    }
  }
  async function submit() {
    if (pending || isUploading || !extensionMode) return;
    const command = commandToken(draft.text);
    const localName = command && localCommand(command.name, session.commands);
    if (localName) {
      if (command.args.trim() && localName !== "model") { onError(`/${command.name} 不接受参数，未发送`); return; }
      if (localName === "model") {
        if (command.args.trim()) {
          const model = session.models.find(item => item.id === command.args.trim() || item.name === command.args.trim());
          if (!model) { onError("模型不在当前目录中"); return; }
          if (!await onAction(() => request("sessionModel", { sessionId: session.id, model: model.id }))) return;
        } else modelPicker.current?.focus();
      } else if (localName === "skills") { setManual("skill"); setDismissed(false); }
      else if (localName === "help") { setManual("command"); setDismissed(false); }
      else if (!await onLocalCommand(localName)) return;
      update(session.id, value => ({ ...value, text: "" }), true);
      return;
    }
    if (["unknown", "stopping"].includes(session.state)) return;
    await onSend(); setManual(undefined); setDismissed(false);
  }
  return <div className={`chat-compose-area ${dragging ? "dragging" : ""}`} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { setDragging(false); if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void addFiles([...event.dataTransfer.files]); } }}>
    {showMenu && <div className="composer-suggestions" role="listbox" id={menuId} aria-label={kind === "command" ? "命令建议" : "引用建议"}>
      {candidates.map((item, index) => <button type="button" role="option" aria-selected={active === index} id={`${menuId}-${index}`} key={item.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>
        {item.kind === "connect" ? item.id === "refresh" ? <RefreshCw size={15} /> : <Plug size={15} /> : item.kind === "command" ? <Slash size={15} /> : item.kind === "file" ? <FilePlus2 size={15} /> : item.reference?.kind === "page" ? <Globe size={15} /> : item.reference?.kind === "skill" ? <Sparkles size={15} /> : <FileCode2 size={15} />}
        <span><strong>{item.label}</strong><small>{item.kind === "command" ? `${nativeNames.has(item.command ?? "") ? name : "BeeHelper"} · ` : ""}{item.description}</small></span>
      </button>)}
      {!candidates.length && <div className="suggestion-empty">无匹配项</div>}
    </div>}
    <form className="composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {draft.references.length > 0 && <div className="draft-references">{draft.references.map(ref => <span key={`${ref.kind}:${ref.id}`} title={`${ref.kind} · ${ref.id}`}><AtSign size={11} /><strong>{ref.label}</strong><button type="button" className="icon-button" aria-label={`移除引用 ${ref.label}`} title="移除引用" onClick={() => update(session.id, value => ({ ...value, text: value.text.replace(`@${ref.label}`, ""), references: value.references.filter(item => `${item.kind}:${item.id}` !== `${ref.kind}:${ref.id}`) }))}><X size={11} /></button></span>)}</div>}
      {draft.attachments.length > 0 && <ChatAttachments items={draft.attachments} sessionId={session.id} onError={onError} onRemove={id => update(session.id, value => ({ ...value, attachments: value.attachments.filter(item => item.id !== id) }), true)} />}
      {displayedUploads.length > 0 && <div className="uploads" aria-label="附件上传进度">{displayedUploads.map(item => <div key={item.id}><span>{item.error ? item.error : `${item.file.name} · ${item.progress}%`}</span>{!item.error && <progress max={100} value={item.progress} />}{item.error && <button type="button" className="icon-button" title="重试上传" aria-label={`重试上传 ${item.file.name}`} onClick={() => { setUploads(current => current.filter(upload => upload.id !== item.id)); void addFiles([item.file]); }}><RotateCcw size={13} /></button>}<button type="button" className="icon-button" title="取消上传" aria-label={`取消上传 ${item.file.name}`} onClick={() => { item.controller.abort(); setUploads(current => current.filter(upload => upload.id !== item.id)); }}><X size={13} /></button></div>)}</div>}
      <textarea ref={textarea} aria-label={`发送给 ${name}`} placeholder="描述任务或想要修改的地方…" aria-controls={showMenu ? menuId : undefined} aria-activedescendant={showMenu && candidates.length ? `${menuId}-${active}` : undefined} aria-expanded={showMenu} value={draft.text} onChange={event => { update(session.id, { ...draft, text: event.target.value }); setCursor(event.target.selectionStart); setManual(undefined); setDismissed(false); }} onSelect={event => setCursor(event.currentTarget.selectionStart)} rows={1}
        onPaste={event => {
          const files = [...event.clipboardData.files];
          const text = event.clipboardData.getData("text/plain");
          const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd;
          if (!files.length) {
            if (text.length + draft.text.length - (end - start) > 50_000) {
              event.preventDefault(); void addFiles([new File([text], "粘贴文本.txt", { type: "text/plain" })]);
            }
            return;
          }
          event.preventDefault();
          if (text) {
            if (text.length + draft.text.length - (end - start) > 50_000) files.push(new File([text], "粘贴文本.txt", { type: "text/plain" }));
            else { update(session.id, { ...draft, text: draft.text.slice(0, start) + text + draft.text.slice(end) }); setCursor(start + text.length); }
          }
          void addFiles(files);
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (showMenu && event.key === "Escape") { event.preventDefault(); setDismissed(true); setManual(undefined); return; }
          if (showMenu && candidates.length && ["ArrowDown", "ArrowUp", "Tab", "Enter"].includes(event.key) && !event.shiftKey) {
            event.preventDefault();
            if (event.key === "ArrowDown") setActive(index => (index + 1) % candidates.length);
            else if (event.key === "ArrowUp") setActive(index => (index + candidates.length - 1) % candidates.length);
            else choose(candidates[Math.min(active, candidates.length - 1)]);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey && (sendOnEnter || event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
        }} />
      <div className="composer-actions">
        <div className="composer-tools">
          <button type="button" className="icon-button" title="添加附件" aria-label="添加附件" onClick={() => picker.current?.click()} disabled={!extensionMode}><Paperclip size={15} /></button>
          <button type="button" className="icon-button" title="引用上下文" aria-label="引用上下文" onClick={() => { setManual("reference"); setDismissed(false); textarea.current?.focus(); }}><AtSign size={15} /></button>
          <button type="button" className="icon-button" title="命令" aria-label="命令" onClick={() => { setManual("command"); setDismissed(false); textarea.current?.focus(); }}><Slash size={15} /></button>
        </div>
        <div className="session-model">
        <select ref={modelPicker} aria-label="模型" value={session.model ?? session.appliedModel ?? ""} disabled={!session.capabilities.models || pending || ["disconnected", "unknown", "connecting"].includes(session.state)} onChange={event => { void onAction(() => request("sessionModel", { sessionId: session.id, model: event.target.value })); }}>
          <option value="" disabled>默认模型</option>
          {session.appliedModel && !session.models.some(model => model.id === session.appliedModel) && <option value={session.appliedModel}>{session.appliedModel}</option>}
          {session.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        {session.model && session.model !== session.appliedModel && <small>下一轮</small>}
        </div>
        <button type="button" className="icon-button" title="会话配置" aria-label="会话配置" aria-expanded={config} onClick={() => setConfig(!config)}><Settings2 size={14} /></button>
        <div className="composer-buttons">
          {busy && <button type="button" className="icon-button" title={`停止 ${name}`} aria-label={`停止 ${name}`} disabled={pending || session.state !== "running"} onClick={() => { void onAction(() => request("cancel", { sessionId: session.id })); }}><Square size={15} /></button>}
          <button type="submit" className="send-button" disabled={(!draft.text.trim() && !draft.attachments.length && !draft.references.length) || pending || isUploading || displayedUploads.some(item => item.error) || !extensionMode || (["stopping", "unknown"].includes(session.state) && !localCommand(commandToken(draft.text)?.name ?? "", session.commands))} aria-label="发送">{pending ? <LoaderCircle size={15} className="spin" /> : <Send size={16} />}</button>
        </div>
      </div>
      {busy && <div className="delivery-options"><select aria-label="消息投递方式" value={mode} onChange={event => setMode(event.target.value as DeliveryMode)}><option value="queue">排队</option><option value="steer" disabled={!session.capabilities.steer}>插话</option></select></div>}
      {config && <div className="chat-config" aria-label="会话配置选项">
        <label>发送方式<select aria-label="发送方式" value={sendOnEnter ? "enter" : "modified"} onChange={event => { const value = event.target.value === "enter"; setSendOnEnter(value); localStorage.setItem("beehelper.enterSend", String(value)); }}><option value="enter">Enter</option><option value="modified">Ctrl / Cmd + Enter</option></select></label>
        {extraOptions.map(option => <label key={option.id}>{option.name}{option.type === "boolean"
          ? <input type="checkbox" aria-label={option.name} checked={Boolean(session.nextConfig?.[option.id] ?? option.currentValue)} disabled={pending} onChange={event => { void onAction(() => request("sessionConfig", { sessionId: session.id, configId: option.id, value: event.target.checked })); }} />
          : <select aria-label={option.name} value={option.options?.some(item => item.value === String(session.nextConfig?.[option.id] ?? option.currentValue)) ? String(session.nextConfig?.[option.id] ?? option.currentValue) : ""} disabled={pending} onChange={event => { void onAction(() => request("sessionConfig", { sessionId: session.id, configId: option.id, value: event.target.value })); }}><option value="" disabled>默认</option>{option.options?.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}</select>}{session.nextConfig?.[option.id] !== undefined && <small>下一轮</small>}</label>)}
      </div>}
    </form>
    <input ref={picker} hidden type="file" multiple aria-label="附件文件" onChange={event => { const files = [...event.target.files ?? []]; event.target.value = ""; if (files.length && token?.kind === "reference") replaceToken(""); void addFiles(files); }} />
  </div>;
});
