import capabilities from "../../shared/capabilities.json";
import { validateDefinition, type Definition } from "./model";

/**
 * Tampermonkey / Greasemonkey 用户脚本 → BeeHelper 微应用。
 *
 * 只做“能跑起来”的兼容：元数据块解析、匹配规则转换、常用 GM_* API 桥接。
 * 不假装支持全部 GM API，也不把运行在隔离世界的限制藏起来。
 */

export interface UserscriptMeta {
  name?: string;
  namespace?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  icon?: string;
  homepage?: string;
  supportURL?: string;
  matches: string[];
  includes: string[];
  excludes: string[];
  requires: string[];
  resources: { name: string; url: string }[];
  grants: string[];
  connects: string[];
  runAt: string;
  noframes: boolean;
  raw: Record<string, string[]>;
}

export interface ParsedUserscript {
  meta: UserscriptMeta;
  body: string;
  raw: string;
}

const START = /^[\t ]*\/\/[\t ]*==UserScript==[\t ]*$/m;
const END = /^[\t ]*\/\/[\t ]*==\/UserScript==[\t ]*$/m;

export function isUserscript(source: string): boolean {
  return START.test(source);
}

/** 解析 Userscript 元数据块；缺少元数据块时抛出可读错误。 */
export function parseUserscript(source: string): ParsedUserscript {
  const text = String(source ?? "");
  if (!START.test(text)) throw new Error("不是用户脚本：缺少 // ==UserScript== 元数据块");
  const startMatch = START.exec(text)!;
  const afterStart = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = END.exec(afterStart);
  if (!endMatch) throw new Error("用户脚本元数据块没有正常结束（缺少 // ==/UserScript==）");
  const block = afterStart.slice(0, endMatch.index);
  const body = afterStart.slice(endMatch.index + endMatch[0].length).replace(/^\s*\n/, "");
  const raw: Record<string, string[]> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^\s*\/\/\s*@([a-zA-Z:-]+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    (raw[key] ??= []).push(value);
  }
  const first = (key: string) => raw[key]?.find(value => value.length > 0);
  const all = (key: string) => (raw[key] ?? []).filter(value => value.length > 0);
  const resources = all("resource").map(item => {
    const [name, ...rest] = item.split(/\s+/);
    return { name, url: rest.join(" ") };
  });
  const meta: UserscriptMeta = {
    name: first("name"),
    namespace: first("namespace"),
    version: first("version"),
    description: first("description"),
    author: first("author") ?? first("copyright"),
    license: first("license"),
    icon: first("icon") ?? first("iconurl") ?? first("defaulticon"),
    homepage: first("homepage") ?? first("homepageurl") ?? first("website"),
    supportURL: first("supporturl"),
    matches: all("match"),
    includes: all("include"),
    excludes: all("exclude"),
    requires: all("require"),
    resources,
    grants: all("grant"),
    connects: all("connect"),
    runAt: first("run-at") ?? "document-idle",
    noframes: raw.noframes !== undefined,
    raw
  };
  return { meta, body, raw: text };
}

/** 把 @match/@include 规则转成 BeeHelper 支持的 Chrome match pattern。 */
export function toChromePattern(value: string): string | null {
  let pattern = value.trim();
  if (!pattern) return null;
  if (pattern === "<all_urls>") return pattern;
  // 正则形式的 @include，无法等价转换；直接跳过而不是猜。
  if (pattern.startsWith("/") && !pattern.startsWith("//")) return null;
  if (!/^(\*|https?):\/\//i.test(pattern)) {
    if (!/^[\w*.-]+(:\d+)?(\/.*)?$/.test(pattern)) return null;
    pattern = `*://${pattern.replace(/^\/\//, "")}`;
  }
  const parsed = /^(\*|https?):\/\/([^/]+)(\/.*)?$/i.exec(pattern);
  if (!parsed) return null;
  const scheme = parsed[1].toLowerCase() === "https" ? "https" : parsed[1].toLowerCase() === "http" ? "http" : "*";
  const host = parsed[2].replace(/:\d+$/, "").toLowerCase();
  if (!host || /[^\w*.-]/.test(host)) return null;
  const path = parsed[3] && parsed[3].startsWith("/") ? parsed[3] : "/*";
  return `${scheme}://${host}${path}`;
}

function globToRegExp(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  // @exclude 也支持 /regex/ 形式。
  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const end = trimmed.lastIndexOf("/");
    try { return new RegExp(trimmed.slice(1, end), trimmed.slice(end + 1)); } catch { return null; }
  }
  if (trimmed === "<all_urls>") return /^https?:/;
  const source = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try { return new RegExp(`^${source}$`); } catch { return null; }
}

/** GM 兼容层源码：注入到微应用源码前面，脚本正文可以直接调用 GM_* API。 */
export function gmBridge(meta: UserscriptMeta): string {
  const metaBlock = JSON.stringify(meta.raw).slice(0, 2000);
  return `/* ---- BeeHelper · Tampermonkey(GM) 兼容层 · 自动生成 ---- */
const __beeGM = await (async () => {
  const BAG = "__gm_values";
  const raw = await bee.storage.get(BAG).catch(() => null);
  const values = raw && typeof raw === "object" ? raw : {};
  let timer = 0;
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => { bee.storage.set(BAG, values).catch(() => {}); }, 120); };
  const watchers = new Map();
  let watcherId = 0;
  const emit = (key, oldValue, newValue) => {
    for (const item of watchers.values()) if (item.key === key) {
      try { item.callback(key, oldValue, newValue, false); } catch (error) { bee.log("GM 监听回调出错: " + error); }
    }
  };
  const toast = text => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:320px;padding:11px 14px;border-radius:8px;font:13px/1.6 system-ui,'PingFang SC',sans-serif;color:#3a2a12;background:linear-gradient(150deg,#fff6dc,#ffe08a);border:1px solid #e6c77d;box-shadow:0 8px 28px #8a5c0033;white-space:pre-wrap";
    host.textContent = String(text);
    document.documentElement.append(host);
    setTimeout(() => host.remove(), 4200);
    return host;
  };
  const style = (css, target) => {
    const element = document.createElement("style");
    element.textContent = String(css);
    (target || document.head || document.documentElement).append(element);
    bee.cleanup(() => element.remove());
    return element;
  };
  const request = details => {
    const controller = new AbortController();
    const init = { method: details.method || "GET", headers: details.headers || {}, signal: controller.signal, credentials: details.withCredentials ? "include" : "same-origin" };
    let body = details.data;
    if (body !== undefined && body !== null) {
      if (typeof body === "object" && !(body instanceof FormData) && !(body instanceof URLSearchParams)) body = JSON.stringify(body);
      init.body = body;
    }
    fetch(details.url, init).then(async response => {
      const type = details.responseType || "";
      let data = response.statusText;
      let text = "";
      if (type === "arraybuffer") data = await response.arrayBuffer();
      else {
        text = await response.text();
        data = text;
        if (type === "json") { try { data = JSON.parse(text); } catch { data = text; } }
      }
      const headers = [...response.headers].map(pair => pair[0] + ": " + pair[1]).join("\\r\\n");
      if (details.onload) details.onload({ status: response.status, statusText: response.statusText, readyState: 4, responseHeaders: headers, responseText: text, response: data, finalUrl: response.url });
    }, error => { if (details.onerror) details.onerror({ error: String(error), readyState: 4 }); });
    return { abort: () => controller.abort() };
  };
  return { values, persist, watchers, nextWatcher: () => ++watcherId, emit, toast, style, request, menu: [] };
})();
const GM_info = {
  scriptHandler: "BeeHelper",
  version: ${JSON.stringify(capabilities.version)},
  script: {
    name: ${JSON.stringify(meta.name ?? "")},
    namespace: ${JSON.stringify(meta.namespace ?? "")},
    version: ${JSON.stringify(meta.version ?? "")},
    description: ${JSON.stringify(meta.description ?? "")},
    author: ${JSON.stringify(meta.author ?? "")},
    matches: ${JSON.stringify(meta.matches)},
    grants: ${JSON.stringify(meta.grants)},
    runAt: ${JSON.stringify(meta.runAt)}
  },
  scriptMetaStr: ${JSON.stringify(metaBlock)}
};
const unsafeWindow = window;
const GM_getValue = (key, fallback) => Object.prototype.hasOwnProperty.call(__beeGM.values, key) ? __beeGM.values[key] : fallback;
const GM_setValue = (key, value) => { const old = __beeGM.values[key]; __beeGM.values[key] = value; __beeGM.persist(); __beeGM.emit(key, old, value); };
const GM_deleteValue = key => { const old = __beeGM.values[key]; delete __beeGM.values[key]; __beeGM.persist(); __beeGM.emit(key, old, undefined); };
const GM_listValues = () => Object.keys(__beeGM.values);
const GM_addValueChangeListener = (key, callback) => { const id = __beeGM.nextWatcher(); __beeGM.watchers.set(id, { key, callback }); return id; };
const GM_removeValueChangeListener = id => { __beeGM.watchers.delete(id); };
const GM_addStyle = css => __beeGM.style(css);
const GM_addElement = (parent, tag, attributes) => {
  const target = typeof parent === "string" ? document.querySelector(parent) : parent;
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) element.setAttribute(name, String(value));
  (target || document.head || document.documentElement).append(element);
  bee.cleanup(() => element.remove());
  return element;
};
const GM_xmlhttpRequest = details => __beeGM.request(details);
const GM_notification = details => __beeGM.toast(typeof details === "string" ? details : [details.title, details.text || details.body].filter(Boolean).join("\\n"));
const GM_setClipboard = (text, type) => {
  const value = String(text);
  if (navigator.clipboard) navigator.clipboard.writeText(value).catch(() => __beeGM.toast(value));
  else __beeGM.toast(value);
};
const GM_openInTab = url => { bee.tabs.open(String(url)).catch(error => bee.log("打开标签页失败: " + error)); return { closed: false, close() {} }; };
const GM_registerMenuCommand = (name, callback) => { __beeGM.menu.push({ name: String(name), callback }); bee.log("已登记菜单命令（BeeHelper 中暂不显示菜单）: " + name); return String(name); };
const GM_unregisterMenuCommand = name => { __beeGM.menu = __beeGM.menu.filter(item => item.name !== name); };
const GM_getResourceText = name => { bee.log("GM_getResourceText 暂不支持: " + name); return ""; };
const GM_getResourceURL = name => { bee.log("GM_getResourceURL 暂不支持: " + name); return ""; };
const GM_download = details => { const options = typeof details === "string" ? { url: details } : details || {}; bee.log("GM_download 暂不支持，请在页面内自行下载: " + (options.url || "")); if (options.onerror) options.onerror({ error: "GM_download 在 BeeHelper 中不可用" }); };
const GM_getTab = callback => { if (callback) callback({}); };
const GM_saveTab = () => {};
const GM_cookie = {
  list: (details, callback) => { if (callback) callback([], "GM_cookie 在 BeeHelper 中不可用"); },
  set: (details, callback) => { if (callback) callback("GM_cookie 在 BeeHelper 中不可用"); },
  delete: (details, callback) => { if (callback) callback("GM_cookie 在 BeeHelper 中不可用"); }
};
/* ---- 兼容层结束 ---- */`;
}

export interface ConvertOptions {
  /** 来源名称，例如 ScriptCat、GreasyFork 或“手动导入”。 */
  source?: string;
  /** 脚本详情页，用于溯源。 */
  pageUrl?: string;
  /** 安装量等展示信息。 */
  installs?: number;
  author?: string;
  version?: string;
}

export interface ConvertedUserscript {
  definition: Definition;
  notes: string[];
  /** 无法自动加载的 @require 依赖。 */
  requires: string[];
  grants: string[];
}

/**
 * 把解析后的用户脚本转成微应用定义。
 * 默认 trigger=manual：导入的第三方代码不会在页面上自动运行。
 */
export function userScriptToDefinition(parsed: ParsedUserscript, options: ConvertOptions = {}): ConvertedUserscript {
  const notes: string[] = [];
  const patterns: string[] = [];
  for (const value of [...parsed.meta.matches, ...parsed.meta.includes]) {
    const pattern = toChromePattern(value);
    if (!pattern) { notes.push(`匹配规则无法等价转换，已跳过：${value}`); continue; }
    if (!patterns.includes(pattern)) patterns.push(pattern);
  }
  if (!patterns.length) throw new Error("脚本没有可用的 @match/@include 规则，无法确定适用页面");
  if (patterns.length > 32) throw new Error("匹配规则超过 32 条，请先精简脚本的 @match 范围");
  const title = (parsed.meta.name ?? "未命名脚本").replace(/\s+/g, " ").trim().slice(0, 100);
  const author = options.author ?? parsed.meta.author;
  const version = options.version ?? parsed.meta.version;
  const provenance = [
    options.source ? `来源：${options.source}` : undefined,
    author ? `作者：${author}` : undefined,
    version ? `版本：${version}` : undefined,
    typeof options.installs === "number" ? `安装量：${options.installs.toLocaleString("zh-CN")}` : undefined,
    options.pageUrl ? `原始页面：${options.pageUrl}` : undefined
  ].filter(Boolean).join(" · ");

  const excludePatterns = parsed.meta.excludes.map(globToRegExp).filter((item): item is RegExp => Boolean(item));
  const guard = excludePatterns.length
    ? `const __beeExcluded = ${JSON.stringify(excludePatterns.map(item => item.source))}.map(source => new RegExp(source)).some(rule => { try { return rule.test(location.href); } catch { return false; } });\nif (__beeExcluded) { bee.log("当前页面被脚本 @exclude 排除，未执行"); return "excluded"; }\n`
    : "";

  const body = parsed.body.trimStart();
  if (!body) throw new Error("脚本正文为空");
  if (body.length > 900_000) throw new Error("脚本源码超过 900 KB，暂不适合导入为单文件微应用");

  const header = `/* 由 BeeHelper 从${options.source ? ` ${options.source} ` : ""}用户脚本导入${options.pageUrl ? `：${options.pageUrl}` : ""} */`;
  const code = [header, gmBridge(parsed.meta), guard, body].filter(Boolean).join("\n");

  const limitation: string[] = [];
  if (parsed.meta.requires.length) limitation.push(`${parsed.meta.requires.length} 个 @require 依赖未自动加载（${parsed.meta.requires.map(item => item.split("/").pop()).slice(0, 3).join("、")}${parsed.meta.requires.length > 3 ? "…" : ""}），脚本可能缺少库函数`);
  const unsupported = parsed.meta.grants.filter(item => !["GM_info", "GM_getValue", "GM_setValue", "GM_deleteValue", "GM_listValues", "GM_addValueChangeListener", "GM_removeValueChangeListener", "GM_addStyle", "GM_addElement", "GM_xmlhttpRequest", "GM_notification", "GM_setClipboard", "GM_openInTab", "GM_registerMenuCommand", "GM_unregisterMenuCommand", "GM_getTab", "GM_saveTab", "GM_cookie", "none", "unsafeWindow"].includes(item));
  if (unsupported.length) limitation.push(`以下 GM API 只有占位实现：${unsupported.slice(0, 6).join("、")}${unsupported.length > 6 ? "…" : ""}`);
  if (parsed.meta.excludes.length) notes.push(`已把 ${parsed.meta.excludes.length} 条 @exclude 转成页面内检查`);
  if (parsed.meta.grants.includes("unsafeWindow")) notes.push("脚本使用 unsafeWindow：BeeHelper 在浏览器隔离世界运行，拿不到页面自身脚本的全局对象");
  if (patterns.some(pattern => pattern === "<all_urls>" || /^(\*|https?):\/\/\*\//.test(pattern))) notes.push("匹配范围覆盖所有网站，安装前请确认脚本行为");
  if (parsed.meta.runAt && !["document-idle", "document-end"].includes(parsed.meta.runAt)) notes.push(`脚本声明 @run-at ${parsed.meta.runAt}；BeeHelper 在页面空闲后执行，依赖更早时机的逻辑可能需要调整`);
  if (parsed.body.length > 200_000) notes.push("脚本较大，页面加载后需要额外时间执行");

  const descriptionParts = [
    (parsed.meta.description ?? "").slice(0, 800) || "从 Tampermonkey 生态导入的用户脚本。",
    provenance,
    limitation.length ? `导入限制：${limitation.join("；")}` : undefined,
    notes.length ? `转换说明：${notes.join("；")}` : undefined,
    "导入后默认手动运行。确认脚本行为符合预期后，可在“编辑属性”里改成匹配页面自动激活，并安装到本地库。"
  ].filter(Boolean);
  let description = descriptionParts.join("\n\n");
  if (description.length > 2000) description = `${description.slice(0, 1980)}…`;

  const definition = validateDefinition({
    schemaVersion: 1,
    title,
    description,
    kind: "page",
    matches: patterns,
    trigger: "manual",
    code
  });
  return { definition, notes, requires: parsed.meta.requires, grants: parsed.meta.grants };
}

export function convertUserscript(source: string, options: ConvertOptions = {}): ConvertedUserscript {
  return userScriptToDefinition(parseUserscript(source), options);
}
