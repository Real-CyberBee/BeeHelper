import { Component, Suspense, lazy, useEffect, useMemo, useRef, type ReactNode } from "react";
import { request } from "../client";
import { systemAppContext, type SystemApp } from "./registry";
class AppBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <section role="alert"><p>内置微应用未能加载。关闭后可重新打开；本地微应用仍可使用。</p><button onClick={this.props.onClose}>关闭并返回</button></section> : this.props.children; }
}
export function SystemAppHost({ app, onClose }: { app: SystemApp; onClose: () => void }) {
  const View = useMemo(() => lazy(app.load), [app]);
  const context = useMemo(() => systemAppContext(app, request, onClose), [app, onClose]);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} tabIndex={-1} className="modal setup-app" role="dialog" aria-modal="true" aria-label={app.manifest.title} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    }}>
      <div className="modal-heading"><h2>{app.manifest.title}</h2><button className="icon-button" aria-label="关闭首次使用与诊断" onClick={onClose}>×</button></div>
      <small>内置微应用 · 不可卸载</small>
      <AppBoundary onClose={onClose}><Suspense fallback={<p>正在加载向导…</p>}><View context={context} /></Suspense></AppBoundary>
    </section>
  </div>;
}
