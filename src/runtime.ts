import type { Definition } from "./core/model";

export function pageProgram(input: { appId: string; runId: string; definition: Definition }): string {
  const settings = JSON.stringify({ appId: input.appId, runId: input.runId });
  return `(async () => {
const settings = ${settings};
const instances = globalThis.__beehelperInstances ||= new Map();
await instances.get(settings.appId)?.dispose();
const cleanups = [];
const report = (type, data) => chrome.runtime.sendMessage({ channel: "bee:script", runId: settings.runId, type, data }).catch(() => {});
const serialize = value => { try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return String(value); } };
const call = async (type, data) => {
  const result = await chrome.runtime.sendMessage({ channel: "bee:script", runId: settings.runId, type, data });
  if (result && typeof result === "object" && typeof result.error === "string") throw new Error(result.error);
  return result;
};
const instance = { runId: settings.runId, dispose: async () => { for (const fn of cleanups.splice(0).reverse()) { try { await fn(); } catch {} } instances.delete(settings.appId); } };
instances.set(settings.appId, instance);
const bee = {
  log: (...values) => report("log", { text: values.map(serialize).join(" ") }),
  output: value => report("output", { text: serialize(value) }),
  cleanup: fn => { cleanups.push(fn); return fn; },
  on: (target, event, callback, options) => {
    if (!target?.addEventListener) throw new Error("事件目标不存在");
    const listener = (...args) => Promise.resolve().then(() => callback(...args)).catch(error => report("log", { level: "error", text: String(error) }));
    target.addEventListener(event, listener, options);
    cleanups.push(() => target.removeEventListener(event, listener, options));
    return () => target.removeEventListener(event, listener, options);
  },
  observe: (target, callback, options = { childList: true, subtree: true }) => {
    const observer = new MutationObserver(callback); observer.observe(target, options); cleanups.push(() => observer.disconnect()); return observer;
  },
  mount: html => {
    const host = document.createElement("div"); host.dataset.beehelper = settings.appId;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = html;
    document.body.append(host); cleanups.push(() => host.remove()); return root;
  },
  fill: (target, value) => {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) throw new Error("填写目标不存在");
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(value));
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
  },
  storage: {
    get: key => call("storageGet", { key }),
    set: (key, value) => call("storageSet", { key, value })
  },
  tabs: {
    list: () => call("tabsList"),
    open: url => call("tabsOpen", { url }),
    inspect: tabId => call("tabsInspect", { tabId }),
    action: args => call("tabsAction", args)
  }
};
try {
  const result = await (async () => {
${input.definition.code}
  })();
  const summary = { result: result === undefined ? null : serialize(result), resources: cleanups.length };
  await report("complete", summary);
  return summary;
} catch (error) {
  await instance.dispose();
  await report("error", { text: error?.stack || String(error) });
  return { error: String(error) };
}
})()`;
}
export function stopProgram(appId: string): string {
  return `(async () => { await globalThis.__beehelperInstances?.get(${JSON.stringify(appId)})?.dispose(); return true; })()`;
}
