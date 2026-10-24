import { useEffect, useState } from "react";
import { diagnosticReport, type SetupSnapshot } from "../core/onboarding";
import type { SystemAppContext } from "./registry";
export default function SetupApp({ context }: { context: SystemAppContext }) {
  const [snapshot, setSnapshot] = useState<SetupSnapshot>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try {
      const next = await context.request<SetupSnapshot>("setupSnapshot");
      setSnapshot(next); setProvider(current => next.providers.some(item => item.id === current && item.available) ? current : next.providers.find(item => item.available)?.id ?? "");
    } catch { setError("检查未完成，请重试。扩展可能已更新，必要时重新打开侧边栏。"); }
    finally { setBusy(false); }
  }
  useEffect(() => { let disposed = false;
    void context.request<SetupSnapshot>("setupSnapshot").then(next => { if (!disposed) { setSnapshot(next); setProvider(next.providers.find(item => item.available)?.id ?? ""); } }, () => { if (!disposed) setError("无法读取检查结果，请重新检测。"); });
    return () => { disposed = true; };
  }, [context]);
  async function finish() {
    setBusy(true);
    try { await context.request("setupComplete"); context.close(); }
    catch { setError("无法保存向导状态，请重试。"); }
    finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setError(""); setConnected(false);
    try {
      const session = await context.request<{ id: string }>("sessionNew", { providerId: provider });
      const result = await context.request<{ ready?: boolean }>("connect", { sessionId: session.id });
      if (!result.ready) throw new Error("客户端未确认就绪");
      setConnected(true);
    } catch { setError("客户端未连接成功。请确认已安装并登录；若有授权请求，关闭向导后在 AI 会话中处理，再回来重新检测。"); }
    finally { setBusy(false); }
  }
  return <div className="setup-content">
    <p>先运行一个微应用，再按需连接 AI。已有微应用的日常运行不需要 AI 在线。</p>
    <ol className="setup-steps">
      <li><strong>确认扩展环境</strong><span>{snapshot ? snapshot.extension ? `扩展已加载 · ${snapshot.version}` : "当前为网页预览，无法操作浏览器页面" : "检查中…"}</span></li>
      <li><strong>允许页面脚本</strong><span>{snapshot?.scripts ? "页面脚本可用" : "请在扩展详情开启「允许用户脚本」，然后重新检测"}</span><button className="secondary" onClick={() => { void context.request("openExtensionDetails").catch(() => setError("请在浏览器扩展页打开 BeeHelper 详情。")); }}>打开扩展详情</button></li>
      <li><strong>本地 AI 连接（可选）</strong><span>{!snapshot ? "检查中…" : snapshot.connector ? `连接器已就绪${snapshot.connectorVersion ? ` · ${snapshot.connectorVersion}` : ""}` : "连接器未响应，请下载 macOS 安装包，安装后重新检测"}</span>
        <button className="secondary" onClick={() => { void context.request("openInstallGuide").catch(() => setError("请从项目 README 打开安装说明。")); }}>下载与安装说明</button>
        {snapshot?.connector && <><label>选择 AI 客户端<select aria-label="向导 AI 客户端" value={provider} onChange={event => { setProvider(event.target.value); setConnected(false); }}>{!provider && <option value="">尚无可用客户端</option>}{snapshot.providers.filter(item => item.available).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {!provider && <p>未检测到可用客户端。已有微应用仍可运行；AI 创作需先安装并登录 Codex、Claude Code 或 DeepSeek Harness。</p>}
          <button className="secondary" disabled={busy || !provider} onClick={() => { void connect(); }}>连接所选客户端</button></>}
        {connected && <span role="status">AI 客户端已连接</span>}
      </li>
      <li><strong>完成第一次使用</strong><span>关闭向导后，在示例画廊添加「批量文本整理」并试试。它不需要 AI，也不读取业务页面。</span></li>
    </ol>
    {error && <p role="alert" className="setting-error">{error}</p>}
    <div className="setting-actions"><button className="secondary" disabled={busy} onClick={() => { void refresh(); }}>{busy ? "检查中…" : "重新检测"}</button>
      <button className="secondary" disabled={!snapshot} onClick={() => {
        if (!snapshot) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosticReport(snapshot), null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "beehelper-diagnostics.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>导出脱敏诊断</button></div>
    <small>诊断只包含版本与能力状态，不包含页面地址、源码、会话、机器路径或凭据。设置入口可随时重新打开向导。</small>
    <div className="modal-actions"><button className="primary" disabled={busy || !snapshot} onClick={() => { void finish(); }}>开始使用微应用</button></div>
  </div>;
}
