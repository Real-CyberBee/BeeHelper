const root = document.querySelector<HTMLElement>("#app")!;
let token: string | undefined;
let cleanups: (() => void)[] = [];
const calls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
let requestId = 0;
function report(type: string, data: unknown) { parent.postMessage({ channel: "bee:sandbox", token, type, data }, "*"); }
function rpc(method: string, args: unknown) {
  const id = String(++requestId);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { calls.delete(id); reject(new Error("宿主请求超时")); }, 15_000);
    calls.set(id, { resolve, reject, timeout }); report("rpc", { id, method, args });
  });
}
function dispose() {
  for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch {} }
  cleanups = []; root.replaceChildren();
  for (const call of calls.values()) { clearTimeout(call.timeout); call.reject(new Error("界面已关闭")); } calls.clear();
}
window.addEventListener("message", event => {
  if (event.source !== parent || event.data?.channel !== "bee:preview") return;
  if (event.data.type === "rpcResult" && event.data.token === token) {
    const call = calls.get(event.data.id);
    if (call) { clearTimeout(call.timeout); calls.delete(event.data.id); event.data.error ? call.reject(new Error(event.data.error)) : call.resolve(event.data.result); }
    return;
  }
  if (event.data.type === "stop" && event.data.token === token) { dispose(); return; }
  if (event.data.type !== "run" || token) return;
  token = event.data.token;
  const bee = {
    mount: (html: string) => { root.innerHTML = html; return root; },
    log: (...values: unknown[]) => report("log", values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" ")),
    output: (value: unknown) => report("log", JSON.stringify(value)),
    cleanup: (callback: () => void) => { cleanups.push(callback); },
    on: (target: EventTarget, name: string, callback: (event: Event) => unknown, options?: AddEventListenerOptions) => {
      if (!target) throw new Error("事件目标不存在");
      const listener = (event: Event) => { void Promise.resolve().then(() => callback(event)).catch(error => report("error", String(error))); };
      target.addEventListener(name, listener, options);
      cleanups.push(() => target.removeEventListener(name, listener, options));
    },
    observe: (target: Node, callback: MutationCallback, options?: MutationObserverInit) => {
      const observer = new MutationObserver(callback); observer.observe(target, options ?? { childList: true, subtree: true }); cleanups.push(() => observer.disconnect()); return observer;
    },
    storage: { get: (key: string) => rpc("get", { key }), set: (key: string, value: unknown) => rpc("set", { key, value }) },
    tabs: {
      list: () => rpc("capability", { capability: "tabsList" }),
      open: (url: string) => rpc("capability", { capability: "tabsOpen", args: { url } }),
      inspect: (tabId: number) => rpc("capability", { capability: "tabsInspect", args: { tabId } }),
      action: (args: unknown) => rpc("capability", { capability: "tabsAction", args })
    },
    fill: (target: HTMLInputElement | string, value: string) => {
      const element = typeof target === "string" ? document.querySelector<HTMLInputElement>(target)! : target;
      element.value = value; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  void new AsyncFunction("bee", event.data.code)(bee).then((value: unknown) => report("complete", { value: value === undefined ? null : String(value), resources: cleanups.length }), (error: Error) => { dispose(); report("error", error.stack ?? String(error)); });
});
window.addEventListener("error", event => report("error", event.message));
report("ready", null);
