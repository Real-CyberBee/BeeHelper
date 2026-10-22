import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileCode2, Flame, LoaderCircle, RefreshCw, Search, Sparkles, Store, X } from "lucide-react";
import { extensionMode, request } from "../client";
import { sourceLabels, sourceReady, type ScriptSearchResult, type ScriptSort, type ScriptSource } from "../core/script-sources";
import { convertUserscript } from "../core/userscripts";
import type { Entry } from "../core/model";

const sorts: { value: ScriptSort; label: string }[] = [
  { value: "popular", label: "最热门" },
  { value: "trending", label: "近日热门" },
  { value: "recent", label: "最近更新" },
  { value: "score", label: "评分最高" }
];

function installs(value?: number): string {
  if (!value) return "0";
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(1)} 千万`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)} 万`;
  return value.toLocaleString("zh-CN");
}

export interface ImportedScript { entry: Entry; notes: string[]; requires: string[] }

interface Props {
  onClose: () => void;
  onImported: (result: ImportedScript) => void;
  onError: (message: string) => void;
}

export function ScriptMarket({ onClose, onImported, onError }: Props) {
  const [source, setSource] = useState<ScriptSource>("scriptcat");
  const [sort, setSort] = useState<ScriptSort>("popular");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ScriptSearchResult>();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string>();
  const [error, setError] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  async function search(next: { source?: ScriptSource; sort?: ScriptSort; query?: string } = {}) {
    if (!extensionMode) { setError("脚本市场需要在 Chrome 扩展中使用：后台抓取不受网页 CORS 限制。"); return; }
    const target = { source: next.source ?? source, sort: next.sort ?? sort, query: next.query ?? query };
    setLoading(true); setError("");
    try {
      const data = await request<ScriptSearchResult>("userscriptSearch", { source: target.source, sort: target.sort, query: target.query.trim(), limit: 20 });
      if (!alive.current) return;
      setResult(data);
    } catch (failure) {
      if (alive.current) { setResult(undefined); setError(failure instanceof Error ? failure.message : String(failure)); }
    } finally { if (alive.current) setLoading(false); }
  }

  useEffect(() => { void search({ source, sort, query }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, sort]);

  async function importOne(id: string, name: string) {
    setImporting(id); setError("");
    try {
      const data = await request("userscriptImport", { source, id });
      onImported({ entry: data.entry as Entry, notes: data.notes ?? [], requires: data.requires ?? [] });
      onError("");
      setImporting(undefined);
      onClose();
      void name;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setImporting(undefined);
    }
  }

  async function importLocal(file: File) {
    setLocalBusy(true); setError("");
    try {
      if (file.size > 2_000_000) throw new Error("脚本文件超过 2 MB，暂不支持导入");
      const text = await file.text();
      const converted = convertUserscript(text, { source: "本地文件" });
      const entry = await request<Entry>("operation", { operation: { type: "create", definition: converted.definition, source: "本地用户脚本" } });
      onImported({ entry, notes: converted.notes, requires: converted.requires });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setLocalBusy(false); }
  }

  const items = useMemo(() => result?.items ?? [], [result]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="market-title">
      <div className="modal-heading">
        <div className="modal-section-heading" style={{ margin: 0 }}>
          <Store size={20} style={{ color: "#c0810c" }} />
          <h2 id="market-title">脚本市场</h2>
          <p>从 Tampermonkey 生态找现成脚本，一键变成可改、可试、可安装的微应用</p>
        </div>
        <button type="button" className="icon-button" title="关闭脚本市场" aria-label="关闭脚本市场" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="modal-intro">
        <strong>不是装一个脚本就结束：</strong>导入后会变成 BeeHelper 的候选微应用，源码可读、可让 AI 改、可先试用再安装。导入默认「手动运行」，确认行为后再改成页面自动激活。
      </div>
      <div className="chip-row" role="tablist" aria-label="脚本来源">
        {(Object.keys(sourceLabels) as ScriptSource[]).map(value => <button key={value} type="button" role="tab" aria-selected={source === value} className={`chip ${source === value ? "active" : ""}`} title={sourceReady[value]} onClick={() => setSource(value)}>{sourceLabels[value]}</button>)}
        <button type="button" className="chip" disabled={localBusy} onClick={() => fileInput.current?.click()} title="导入本地 .user.js 文件"><FileCode2 size={12} />本地 .user.js</button>
        <input ref={fileInput} type="file" hidden accept=".js,.user.js,text/javascript" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importLocal(file); }} />
      </div>
      <form className="market-search" onSubmit={event => { event.preventDefault(); void search(); }}>
        <Search size={15} />
        <input aria-label="搜索用户脚本" placeholder={source === "scriptcat" ? "搜索脚本，例如 暗黑模式、网课、去广告、B站" : "搜索 GreasyFork 脚本，例如 dark mode、youtube"} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="submit" className="chip" style={{ border: 0 }}>搜索</button>
      </form>
      <div className="market-meta">
        {sorts.map(item => <button key={item.value} type="button" className={`chip ${sort === item.value ? "active" : ""}`} onClick={() => setSort(item.value)}>{item.value === "trending" ? <Flame size={11} /> : item.value === "popular" ? <Sparkles size={11} /> : null}{item.label}</button>)}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5 }}>
          {result ? <><b>{result.items.length}</b> 条 · {sourceReady[source]}{result.cached ? " · 缓存" : ""}</> : sourceReady[source]}
          <button type="button" className="icon-button" style={{ width: 24, height: 24 }} title="重新搜索" aria-label="重新搜索" disabled={loading} onClick={() => void search()}><RefreshCw size={13} className={loading ? "spin" : ""} /></button>
        </span>
      </div>
      {error && <div className="market-empty"><strong>这次没连上脚本源</strong>{error}<br />可以直接导入本地 .user.js 文件，或稍后重试。</div>}
      {!error && loading && <div className="market-loading"><LoaderCircle size={16} className="spin" />正在从 {sourceLabels[source]} 读取热门脚本…</div>}
      {!error && !loading && !items.length && <div className="market-empty"><strong>没有找到匹配脚本</strong>换一个关键词，或切换到另一个来源看看。</div>}
      {!error && !loading && items.length > 0 && <div className="market-list">
        {items.map(item => <article className="market-row" key={`${item.source}-${item.id}`}>
          {item.iconUrl ? <img src={item.iconUrl} alt="" referrerPolicy="no-referrer" onError={event => { (event.currentTarget as HTMLImageElement).style.display = "none"; }} /> : <span className="market-fallback">{item.name.slice(0, 1)}</span>}
          <div className="market-copy">
            <strong>{item.name}</strong>
            <p>{item.description || "作者没有写简介。"}</p>
            <div className="market-stats">
              <span>安装 <b>{installs(item.totalInstalls)}</b></span>
              {item.dailyInstalls ? <span>今日 <b>{installs(item.dailyInstalls)}</b></span> : null}
              {item.score ? <span>评分 <b>{item.score.toFixed(1)}</b>{item.scoreCount ? ` (${item.scoreCount})` : ""}</span> : null}
              {item.author ? <span>作者 <b>{item.author}</b></span> : null}
              {item.version ? <span>v{item.version}</span> : null}
            </div>
            {item.tags?.length ? <div className="gallery-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
          </div>
          <div className="market-actions">
            <button type="button" className="gold" disabled={importing === item.id} onClick={() => void importOne(item.id, item.name)}>{importing === item.id ? <LoaderCircle size={12} className="spin" /> : <Download size={12} />}导入为候选</button>
            <button type="button" onClick={() => { if (extensionMode) void chrome.tabs.create({ url: item.pageUrl }); }}><ExternalLink size={12} />原始页面</button>
          </div>
        </article>)}
      </div>}
      <p className="market-note">脚本版权与行为由原作者决定，导入前请确认它做什么。BeeHelper 不会自动运行导入的第三方脚本，也不会把脚本内容上传到任何服务器。脚本源不可用时，可以下载 .user.js 文件后离线导入。</p>
    </section>
  </div>;
}
