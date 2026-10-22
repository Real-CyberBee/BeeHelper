import type { Definition } from "./model";

/**
 * 示例画廊。每个示例都是可直接运行的微应用定义，代码只用公开 SDK，
 * 目的是让人看完就想到“我也能用它做点什么”。
 */
export interface Demo {
  id: string;
  emoji: string;
  title: string;
  tagline: string;
  /** 一句话点出这个示例展示了什么能力边界 */
  highlight: string;
  tags: string[];
  definition: Definition;
}

const UI = "<style>" +
  ".bee-card{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:308px;font:13px/1.65 system-ui,'PingFang SC',sans-serif;color:#3a2a12;background:#fffdf6;border:1px solid #e6c77d;border-radius:12px;box-shadow:0 14px 44px #8a5c0040;overflow:hidden}" +
  ".bee-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#fff6dc,#ffe08a);border-bottom:1px solid #f0d9a4}" +
  ".bee-head b{flex:1;font-size:13px;font-weight:650}" +
  ".bee-head span{font-size:10px;color:#8a6410;background:#fffdf6cc;border:1px solid #e6c77d;border-radius:3px;padding:1px 5px}" +
  ".bee-body{padding:12px;display:flex;flex-direction:column;gap:9px}" +
  ".bee-body p{margin:0;color:#8a7752;font-size:11.5px}" +
  ".bee-btn{all:unset;cursor:pointer;text-align:center;font-size:12px;padding:7px 10px;border-radius:6px;border:1px solid #ead9b2;background:#fff;color:#6d5730}" +
  ".bee-btn:hover{background:#fff8e4}" +
  ".bee-btn.gold{background:linear-gradient(180deg,#ffc94d,#f2ae2b);border-color:#e0a01f;color:#33230a;font-weight:600}" +
  ".bee-btn.gold:hover{background:linear-gradient(180deg,#ffbd2f,#e39e18)}" +
  ".bee-input{display:flex;align-items:center;gap:6px;border:1px solid #ead9b2;border-radius:6px;background:#fff;padding:0 8px}" +
  ".bee-input input{flex:1;min-width:0;border:0;background:transparent;padding:7px 0;font:12px system-ui;color:#3a2a12;outline:none}" +
  ".bee-row{display:flex;align-items:center;gap:7px;font-size:11.5px;padding:6px 0;border-bottom:1px solid #f7efd9}" +
  ".bee-row:last-child{border-bottom:0}" +
  ".bee-row b{font-weight:500;color:#3a2a12;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px}" +
  ".bee-row small{color:#a08d64;font-size:9.5px;margin-left:auto;white-space:nowrap}" +
  ".bee-list{max-height:250px;overflow:auto}" +
  ".bee-empty{color:#a08d64;font-size:11.5px;text-align:center;padding:18px 0}" +
  ".bee-note{font-size:10px;color:#a08d64;line-height:1.7}" +
  ".bee-chip{all:unset;cursor:pointer;font-size:10.5px;padding:3px 8px;border-radius:999px;border:1px solid #ead9b2;color:#8a6410;background:#fff8e4}" +
  ".bee-chip:hover{border-color:#e0c27a}" +
  "</style>";

const pageLayout = (title: string, subtitle: string) =>
  `<div class="bee-head"><b>${title}</b><span>${subtitle}</span><button class="bee-btn" data-close style="padding:2px 7px;border:0;background:transparent;font-size:15px;line-height:1">×</button></div>`;

export const demos: Demo[] = [
  {
    id: "self-modify",
    emoji: "🤖",
    title: "让 AI 改造我自己",
    tagline: "在微应用里说一句话，侧边栏的 AI 就读取源码、改代码、等你看效果。",
    highlight: "微应用可以主动呼叫 AI —— 这就是 DSH 式的自我改造",
    tags: ["AI 协作", "自我改造", "一切皆插件"],
    definition: {
      schemaVersion: 1,
      title: "让 AI 改造我自己",
      description: "在微应用内部描述需求，直接调用 BeeHelper 中已连接的 AI 会话，让它读取当前微应用源码并修改。需要先在侧边栏连接 Codex / Claude Code / DSH。",
      kind: "panel",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const root = bee.mount(
  '<style>' +
  '.self-wrap{display:flex;flex-direction:column;gap:10px}' +
  '.self-wrap h2{margin:0;font-size:17px}' +
  '.self-wrap textarea{width:100%;box-sizing:border-box;padding:9px;border:1px solid #ead9b2;border-radius:6px;font:12px/1.7 system-ui;color:#3a2a12;background:#fff;resize:vertical}' +
  '.self-chips{display:flex;flex-wrap:wrap;gap:6px}' +
  '.self-chips button{padding:4px 9px;border-radius:999px;border:1px solid #ead9b2;background:#fff8e4;color:#8a6410;font-size:11px;cursor:pointer}' +
  '.self-go{padding:9px 12px;border:1px solid #e0a01f;border-radius:6px;background:linear-gradient(180deg,#ffc94d,#f2ae2b);color:#33230a;font-weight:600;cursor:pointer}' +
  '.self-out{min-height:20px;font-size:11.5px;color:#8a7752;line-height:1.7}' +
  '</style>' +
  '<div class="self-wrap">' +
  '<h2>🤖 让 AI 改造我自己</h2>' +
  '<p class="self-out">写下想要的变化。AI 会读取这个微应用的源码，改完后你可以在工作台继续看效果。</p>' +
  '<textarea id="ask" rows="4" placeholder="例如：把界面改成左右两栏，右边显示运行日志"></textarea>' +
  '<div class="self-chips">' +
  '<button data-fill="加一个一键复制结果的按钮，复制后给个提示">加一键复制</button>' +
  '<button data-fill="把界面改成左右两栏布局，左边输入右边输出">改成两栏</button>' +
  '<button data-fill="加一组示例数据按钮，点一下自动填入输入框">加示例数据</button>' +
  '</div>' +
  '<button class="self-go" id="send">让 AI 改造我</button>' +
  '<output class="self-out" id="out"></output>' +
  '</div>'
);
const ask = root.querySelector("#ask");
const out = root.querySelector("#out");
for (const chip of root.querySelectorAll("[data-fill]")) {
  bee.on(chip, "click", () => { ask.value = chip.dataset.fill; ask.focus(); });
}
bee.on(root.querySelector("#send"), "click", async () => {
  const requirement = ask.value.trim();
  if (!requirement) { out.textContent = "先写一句你希望改成什么样。"; return; }
  out.textContent = "正在把需求交给 AI 会话…";
  bee.log("请求 AI 改造：" + requirement);
  try {
    const result = await bee.askAI("请直接修改当前微应用（已在引用里提供）：" + requirement + "。保留现有功能，保持单文件可运行，改完说明改了什么。");
    out.textContent = "需求已进入 AI 会话排队。去看看它怎么改我 —— 改完这里不用刷新，源码会被更新。";
    if (result && result.sessionId) bee.log("已投递到会话 " + result.sessionId);
  } catch (error) {
    out.textContent = "呼叫 AI 失败：" + String(error) + "。请先在侧边栏连接一个 AI 客户端。";
  }
});
return "自我改造面板已就绪";`
    }
  },
  {
    id: "plugin-hub",
    emoji: "🧩",
    title: "插件中枢：微应用管理微应用",
    tagline: "一个微应用列出、运行、收藏其他微应用，证明「一切皆插件」。",
    highlight: "能力边界：微应用可以组合、调度其他微应用",
    tags: ["一切皆插件", "组合能力", "元编程"],
    definition: {
      schemaVersion: 1,
      title: "插件中枢",
      description: "列出本地库里的所有微应用，可以在当前标签页运行页面脚本、打开界面型微应用、切换收藏状态。演示微应用之间的组合能力。",
      kind: "panel",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const root = bee.mount(
  '<style>' +
  '.hub{display:flex;flex-direction:column;gap:9px}' +
  '.hub-head{display:flex;align-items:center;gap:8px}' +
  '.hub-head h2{margin:0;font-size:17px;flex:1}' +
  '.hub-head button{padding:4px 9px;border:1px solid #ead9b2;border-radius:5px;background:#fff;color:#6d5730;font-size:11px;cursor:pointer}' +
  '.hub-list{display:flex;flex-direction:column;gap:6px;max-height:330px;overflow:auto}' +
  '.hub-row{display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid #f0e3c4;border-radius:7px;background:#fffdf6}' +
  '.hub-row .k{font-size:9.5px;padding:2px 5px;border-radius:3px;background:#fff2cc;color:#8a5c00;border:1px solid #f2dfa6;white-space:nowrap}' +
  '.hub-row strong{font-size:11.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}' +
  '.hub-row button{padding:3px 8px;border:1px solid #ead9b2;border-radius:4px;background:#fff;color:#6d5730;font-size:10.5px;cursor:pointer;white-space:nowrap}' +
  '.hub-row button:hover{background:#fff8e4}' +
  '.hub-row button.on{background:#fff2cc;border-color:#e0c27a;color:#8a5c00}' +
  '.hub-out{font-size:11px;color:#8a7752;min-height:18px;line-height:1.7}' +
  '</style>' +
  '<div class="hub"><div class="hub-head"><h2>🧩 插件中枢</h2><button id="refresh">刷新</button></div>' +
  '<p class="hub-out">微应用可以列出、运行、收藏其他微应用。选一个试试 —— 这就是「一切皆插件」。</p>' +
  '<div class="hub-list" id="list"></div><output class="hub-out" id="out"></output></div>'
);
const list = root.querySelector("#list");
const out = root.querySelector("#out");
async function render() {
  list.textContent = "读取本地库…";
  try {
    const apps = await bee.apps.list();
    list.innerHTML = "";
    if (!apps.length) { list.innerHTML = '<p class="hub-out">本地库是空的，先去示例画廊添加几个微应用。</p>'; return; }
    for (const app of apps) {
      const row = document.createElement("div");
      row.className = "hub-row";
      row.innerHTML = '<span class="k"></span><strong></strong><button data-act="run">运行</button><button data-act="fav">收藏</button>';
      row.querySelector(".k").textContent = app.kind === "page" ? "页面" : "界面";
      row.querySelector("strong").textContent = app.title;
      row.querySelector("strong").title = app.description || app.title;
      const fav = row.querySelector('[data-act="fav"]');
      if (app.favorite) fav.classList.add("on");
      bee.on(row.querySelector('[data-act="run"]'), "click", async () => {
        try {
          if (app.kind === "panel") {
            await bee.apps.run(app.id);
            out.textContent = "已打开「" + app.title + "」的界面预览。";
          } else {
            const tabs = await bee.tabs.list();
            const tab = tabs.find(item => item.active) || tabs[0];
            if (!tab) throw new Error("没有可运行的网页标签页");
            await bee.apps.run(app.id, tab.id);
            out.textContent = "已在「" + (tab.title || tab.url) + "」上运行「" + app.title + "」。";
          }
        } catch (error) { out.textContent = "运行失败：" + String(error); }
      });
      bee.on(fav, "click", async () => {
        try {
          await bee.apps.update(app.id, { favorite: !app.favorite });
          const message = (app.favorite ? "已取消收藏：" : "已收藏：") + app.title;
          await render();
          out.textContent = message;
        } catch (error) { out.textContent = String(error); }
      });
      list.append(row);
    }
    out.textContent = "共 " + apps.length + " 个微应用，其中 " + apps.filter(app => app.installed).length + " 个已安装。";
  } catch (error) { list.textContent = "读取失败：" + String(error); }
}
bee.on(root.querySelector("#refresh"), "click", render);
await render();
return "插件中枢已就绪";`
    }
  },
  {
    id: "element-probe",
    emoji: "🔍",
    title: "页面元素探针",
    tagline: "指向任意元素就显示它的结构和唯一选择器，点一下复制给 AI。",
    highlight: "能力边界：能观察页面、也能把页面语言转成可复用的选择器",
    tags: ["页面增强", "调试工具", "给 AI 看页面"],
    definition: {
      schemaVersion: 1,
      title: "页面元素探针",
      description: "悬停高亮页面元素，点击复制它的 CSS 选择器、标签与文本，方便写自动化或让 AI 理解页面结构。按 Esc 退出。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const host = bee.mount(${JSON.stringify(UI)} +
  '<div class="bee-card">' + ${JSON.stringify(pageLayout("🔍 元素探针", "Esc 退出"))} +
  '<div class="bee-body">' +
  '<p id="hint">把鼠标移到任意元素上，点击即可复制选择器。</p>' +
  '<div class="bee-input"><input id="sel" readonly placeholder="点击页面元素…" /><button class="bee-btn" id="copy" style="padding:4px 8px">复制</button></div>' +
  '<div class="bee-note" id="info">标签：— · 文本：—</div>' +
  '<output class="bee-note" id="out"></output>' +
  '</div></div>');
const card = host.querySelector(".bee-card");
const hostElement = host.host;
function fromCard(event) { return event.composedPath().includes(hostElement); }
const box = document.createElement("div");
box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #f2ae2b;background:#ffe08a22;border-radius:3px;transition:left .06s,top .06s,width .06s,height .06s";
document.documentElement.append(box);
bee.cleanup(() => box.remove());
bee.cleanup(() => card.remove());
const selInput = host.querySelector("#sel"), info = host.querySelector("#info"), out = host.querySelector("#out");
let current = null, done = false;
function esc(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, function (ch) { return "\\\\" + ch; });
}
function uniqueId(element) {
  if (!element.id) return null;
  const byId = "#" + esc(element.id);
  try { return document.querySelectorAll(byId).length === 1 ? byId : null; } catch (error) { return null; }
}
function selectorFor(element) {
  const parts = [];
  let node = element;
  while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
    const byId = uniqueId(node);
    if (byId) { parts.unshift(byId); break; }
    let part = node.tagName.toLowerCase();
    const classes = Array.from(node.classList || []).filter(function (name) { return /^[a-zA-Z_-][\\w-]*$/.test(name); }).slice(0, 2);
    if (classes.length) part += "." + classes.map(esc).join(".");
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter(function (child) { return child.tagName === node.tagName; });
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}
function highlight(element) {
  if (!element || element === box) return;
  const rect = element.getBoundingClientRect();
  box.style.left = rect.left + "px"; box.style.top = rect.top + "px";
  box.style.width = rect.width + "px"; box.style.height = rect.height + "px";
}
function show(element) {
  current = element;
  const selector = selectorFor(element);
  selInput.value = selector;
  const text = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("placeholder") || "").trim().replace(/\\s+/g, " ").slice(0, 120);
  info.textContent = "标签：" + element.tagName.toLowerCase() + " · 文本：" + (text || "（无）");
  bee.log("定位 " + selector);
}
bee.on(document, "mousemove", function (event) {
  const target = event.target;
  if (!(target instanceof Element) || fromCard(event)) return;
  highlight(target);
}, { capture: true });
bee.on(document, "click", function (event) {
  if (done) return;
  const target = event.target;
  if (!(target instanceof Element) || fromCard(event)) return;
  event.preventDefault(); event.stopPropagation();
  show(target);
}, { capture: true });
bee.on(host.querySelector("#copy"), "click", async function () {
  if (!selInput.value) return;
  try { await navigator.clipboard.writeText(selInput.value); out.textContent = "已复制，可以粘贴到对话里让 AI 改。"; }
  catch (error) { selInput.select(); out.textContent = "浏览器不允许自动复制，已选中文本。"; }
});
bee.on(host.querySelector("[data-close]"), "click", function () { cleanup(); });
function cleanup() {
  done = true; box.remove(); card.remove();
  bee.log("元素探针已关闭");
}
bee.on(document, "keydown", function (event) { if (event.key === "Escape") cleanup(); }, { capture: true });
return "元素探针已启动";`
    }
  },
  {
    id: "annotation-pen",
    emoji: "✏️",
    title: "网页批注笔",
    tagline: "直接在任意网页上圈画批注，按网址自动保存，下次打开还在。",
    highlight: "能力边界：覆盖层、指针绘制、私有存储，全是浏览器原生能力",
    tags: ["页面增强", "画布", "本地存储"],
    definition: {
      schemaVersion: 1,
      title: "网页批注笔",
      description: "在网页上自由圈画，按路径保存批注，下次打开同一页面自动恢复。支持颜色、粗细、撤销与清空。按 Esc 退出。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const KEY = "annotations:" + location.pathname;
const strokes = (await bee.storage.get(KEY)) || [];
const canvas = document.createElement("canvas");
canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:2147483640;cursor:crosshair;touch-action:none";
document.documentElement.append(canvas);
const host = bee.mount(${JSON.stringify(UI)} +
  '<div class="bee-card">' + ${JSON.stringify(pageLayout("✏️ 批注笔", "Esc 退出"))} +
  '<div class="bee-body">' +
  '<div style="display:flex;gap:6px" id="colors">' +
  '<button class="bee-btn" data-color="#e5484d" style="flex:1;padding:5px;background:#e5484d;border-color:#e5484d"></button>' +
  '<button class="bee-btn" data-color="#f2ae2b" style="flex:1;padding:5px;background:#f2ae2b;border-color:#f2ae2b"></button>' +
  '<button class="bee-btn" data-color="#1f7a4d" style="flex:1;padding:5px;background:#1f7a4d;border-color:#1f7a4d"></button>' +
  '<button class="bee-btn" data-color="#0e7e8c" style="flex:1;padding:5px;background:#0e7e8c;border-color:#0e7e8c"></button>' +
  '</div>' +
  '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8a7752">粗细 <input id="width" type="range" min="1" max="12" value="3" style="flex:1" /></label>' +
  '<div style="display:flex;gap:6px"><button class="bee-btn" id="undo" style="flex:1">撤销</button><button class="bee-btn" id="clear" style="flex:1">清空</button><button class="bee-btn gold" id="save" style="flex:1">保存</button></div>' +
  '<div class="bee-note" id="count"></div>' +
  '</div></div>');
bee.cleanup(function () { canvas.remove(); host.host ? host.host.remove() : canvas.remove(); });
const ctx = canvas.getContext("2d");
let color = "#e5484d", width = 3, drawing = false, points = [];
function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * ratio); canvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); redraw();
}
function redraw() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.beginPath();
    stroke.points.forEach(function (point, index) { index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]); });
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0][0] + 0.1, stroke.points[0][1]);
    ctx.stroke();
  }
  const count = host.querySelector("#count");
  if (count) count.textContent = "当前页面共 " + strokes.length + " 笔";
}
bee.on(window, "resize", resize);
bee.on(canvas, "pointerdown", function (event) { drawing = true; points = [[event.clientX, event.clientY]]; });
bee.on(canvas, "pointermove", function (event) {
  if (!drawing) return;
  points.push([event.clientX, event.clientY]);
  const last = points.slice(-2);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  ctx.moveTo(last[0][0], last[0][1]); ctx.lineTo(last[1][0], last[1][1]); ctx.stroke();
});
bee.on(window, "pointerup", function () {
  if (!drawing) return;
  drawing = false;
  if (points.length > 1) strokes.push({ color: color, width: width, points: points });
  points = []; redraw();
});
for (const button of host.querySelectorAll("[data-color]")) {
  bee.on(button, "click", function () { color = button.dataset.color; });
}
bee.on(host.querySelector("#width"), "input", function (event) { width = Number(event.target.value); });
bee.on(host.querySelector("#undo"), "click", function () { strokes.pop(); redraw(); });
bee.on(host.querySelector("#clear"), "click", function () { strokes.length = 0; redraw(); });
bee.on(host.querySelector("#save"), "click", async function () {
  await bee.storage.set(KEY, strokes);
  host.querySelector("#count").textContent = "已保存 " + strokes.length + " 笔到本地";
  bee.log("批注已保存：" + location.pathname + " · " + strokes.length + " 笔");
});
bee.on(host.querySelector("[data-close]"), "click", function () { void bee.storage.set(KEY, strokes); canvas.remove(); host.host && host.host.remove(); });
bee.on(document, "keydown", function (event) { if (event.key === "Escape") { void bee.storage.set(KEY, strokes); canvas.remove(); host.host && host.host.remove(); bee.log("批注笔已关闭"); } }, { capture: true });
resize();
bee.log("批注笔已启动，当前页面已有 " + strokes.length + " 笔");
return "批注笔就绪";`
    }
  },
  {
    id: "night-mode",
    emoji: "🌙",
    title: "暗黑护眼模式",
    tagline: "一键把任意网站变暗，亮度对比度随手调，按域名记住你的偏好。",
    highlight: "能力边界：一个滤镜就能重绘整个网站，偏好可以按站点持久化",
    tags: ["页面增强", "个性偏好", "本地存储"],
    definition: {
      schemaVersion: 1,
      title: "暗黑护眼模式",
      description: "给当前网站套上反转滤镜，支持亮度与对比度微调，并按域名记住设置。再次运行可关闭。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const KEY = "night:" + location.host;
const saved = (await bee.storage.get(KEY)) || { brightness: 1, contrast: 1 };
const style = document.createElement("style");
style.textContent =
  "html{filter:invert(1) hue-rotate(180deg) brightness(var(--bee-night-b,1)) contrast(var(--bee-night-c,1));background:#111!important}" +
  "img,video,canvas,picture,svg,[style*='background-image']{filter:invert(1) hue-rotate(180deg)}";
document.head.append(style);
const state = { brightness: Number(saved.brightness) || 1, contrast: Number(saved.contrast) || 1 };
function apply() {
  document.documentElement.style.setProperty("--bee-night-b", String(state.brightness));
  document.documentElement.style.setProperty("--bee-night-c", String(state.contrast));
}
apply();
function close() {
  style.remove();
  document.documentElement.style.removeProperty("--bee-night-b");
  document.documentElement.style.removeProperty("--bee-night-c");
  host.host && host.host.remove();
}
const host = bee.mount(${JSON.stringify(UI)} +
  '<div class="bee-card">' + ${JSON.stringify(pageLayout("🌙 暗黑护眼", "已开启"))} +
  '<div class="bee-body">' +
  '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8a7752">亮度 <input id="b" type="range" min="0.7" max="1.3" step="0.05" value="' + state.brightness + '" style="flex:1" /></label>' +
  '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#8a7752">对比度 <input id="c" type="range" min="0.8" max="1.4" step="0.05" value="' + state.contrast + '" style="flex:1" /></label>' +
  '<div style="display:flex;gap:6px"><button class="bee-btn" id="save" style="flex:1">记住偏好</button><button class="bee-btn gold" id="off" style="flex:1">关闭</button></div>' +
  '<div class="bee-note">只在本机保存这个域名的偏好，不会上传。</div>' +
  '</div></div>');
bee.on(host.querySelector("#b"), "input", function (event) { state.brightness = Number(event.target.value); apply(); });
bee.on(host.querySelector("#c"), "input", function (event) { state.contrast = Number(event.target.value); apply(); });
bee.on(host.querySelector("#save"), "click", async function () {
  await bee.storage.set(KEY, state);
  host.querySelector("#save").textContent = "已记住";
  bee.log("已记住 " + location.host + " 的暗色偏好");
});
bee.on(host.querySelector("#off"), "click", function () { close(); bee.log("暗黑模式已关闭"); });
bee.cleanup(close);
bee.log("已为 " + location.host + " 开启暗黑护眼模式");
return "暗黑模式已开启";`
    }
  },
  {
    id: "reader-mode",
    emoji: "📖",
    title: "专注阅读模式",
    tagline: "把广告、导航、弹窗统统拿掉，只留下正文，字号随心调。",
    highlight: "能力边界：能读懂页面结构，重新编排成你想要的界面",
    tags: ["页面增强", "内容提取", "重排界面"],
    definition: {
      schemaVersion: 1,
      title: "专注阅读模式",
      description: "自动找出页面正文区域，清掉导航与广告后用干净的排版重新展示，支持字号调节，按 Esc 退出。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `function score(element) {
  const text = (element.innerText || "").trim();
  if (text.length < 200) return 0;
  const paragraphs = element.querySelectorAll("p").length;
  return paragraphs * 120 + text.length - element.querySelectorAll("nav,a,script,style").length * 30;
}
const candidates = Array.from(document.querySelectorAll("article, main, [role=main], .post, .article, .content, #content, .markdown-body, .post-content"));
let best = null, bestScore = 0;
for (const element of candidates) { const value = score(element); if (value > bestScore) { best = element; bestScore = value; } }
if (!best) best = document.body;
const clone = best.cloneNode(true);
for (const junk of clone.querySelectorAll("script,style,nav,header,footer,aside,iframe,form,button,input,select,textarea,svg,noscript,[aria-hidden='true'],[class*='advert'],[class*='banner'],[class*='cookie']")) junk.remove();
for (const image of clone.querySelectorAll("img")) {
  const source = image.currentSrc || image.src;
  if (source) image.src = source;
  image.removeAttribute("srcset"); image.removeAttribute("sizes"); image.removeAttribute("loading");
  image.style.maxWidth = "100%"; image.style.height = "auto";
}
for (const link of clone.querySelectorAll("a")) { link.style.color = "#0e7e8c"; }
const title = document.title || "阅读模式";
const host = bee.mount(
  '<style>' +
  '.reader{position:fixed;inset:0;z-index:2147483645;background:#fffdf6;color:#3a2a12;display:flex;flex-direction:column;font:16px/1.9 Georgia,"Songti SC",system-ui,sans-serif}' +
  '.reader-bar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0e3c4;background:linear-gradient(180deg,#fffdf6,#fff8e6);flex-shrink:0}' +
  '.reader-bar b{flex:1;font:600 13px/1.4 system-ui,"PingFang SC",sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.reader-bar button{cursor:pointer;font:12px system-ui;padding:5px 9px;border-radius:5px;border:1px solid #ead9b2;background:#fff;color:#6d5730}' +
  '.reader-bar button:hover{background:#fff8e4}' +
  '.reader-body{flex:1;overflow:auto;padding:36px 24px 80px}' +
  '.reader-body article{max-width:720px;margin:0 auto}' +
  '.reader-body h1{font-size:1.7em;line-height:1.4;margin:0 0 18px;color:#3a2a12}' +
  '.reader-body img{border-radius:8px;margin:12px 0}' +
  '.reader-body pre{background:#fff8e4;padding:12px;border-radius:6px;overflow:auto;font-size:.8em}' +
  '.reader-body blockquote{border-left:3px solid #f2ae2b;margin:16px 0;padding:4px 14px;color:#8a7752}' +
  '.reader-body table{border-collapse:collapse;font-size:.85em}.reader-body td,.reader-body th{border:1px solid #ead9b2;padding:5px 8px}' +
  '</style>' +
  '<div class="reader"><div class="reader-bar"><b>' + title.replace(/[<>&]/g, "") + '</b>' +
  '<button data-size="-">A−</button><button data-size="+">A+</button><button data-close>关闭</button></div>' +
  '<div class="reader-body"><article></article></div></div>'
);
const article = host.querySelector(".reader-body article");
article.append(clone);
let size = 16;
function close() { host.host && host.host.remove(); bee.log("阅读模式已关闭"); }
bee.on(host.querySelector("[data-close]"), "click", close);
for (const button of host.querySelectorAll("[data-size]")) {
  bee.on(button, "click", function () {
    size = Math.max(13, Math.min(22, size + (button.dataset.size === "+" ? 1 : -1)));
    article.style.fontSize = size + "px";
  });
}
bee.on(document, "keydown", function (event) { if (event.key === "Escape") close(); }, { capture: true });
bee.log("阅读模式已提取正文：" + article.innerText.length + " 字");
return "阅读模式已打开";`
    }
  },
  {
    id: "table-chart",
    emoji: "📊",
    title: "表格变图表",
    tagline: "扫一眼页面上的表格，直接画成排序条形图，还能复制 CSV。",
    highlight: "能力边界：把网页里的死数据变成可以带走的结论",
    tags: ["数据提取", "可视化", "页面增强"],
    definition: {
      schemaVersion: 1,
      title: "表格变图表",
      description: "自动挑选页面上数值最多的表格，生成排序条形图并支持复制 CSV。适合快速看懂后台报表或排行榜。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `function cellText(cell) { return (cell.innerText || cell.textContent || "").trim().replace(/\\s+/g, " "); }
function number(value) {
  const cleaned = String(value).replace(/[,\\s¥$€%]/g, "");
  if (!/^-?\\d+(\\.\\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
const tables = Array.from(document.querySelectorAll("table")).map(function (table) {
  const rows = Array.from(table.rows).map(function (row) { return Array.from(row.cells).map(cellText); }).filter(function (row) { return row.length > 1; });
  let numeric = 0, total = 0;
  for (const row of rows.slice(0, 40)) for (const cell of row) { total++; if (number(cell) !== null) numeric++; }
  return { table: table, rows: rows, ratio: total ? numeric / total : 0 };
}).filter(function (item) { return item.rows.length >= 3 && item.ratio > 0.3; }).sort(function (a, b) { return b.ratio - a.ratio || b.rows.length - a.rows.length; });
const host = bee.mount(${JSON.stringify(UI)} + '<div class="bee-card" id="card"></div>');
const card = host.querySelector("#card");
bee.cleanup(function () { host.host && host.host.remove(); });
function header(caption) { return ${JSON.stringify(pageLayout("📊 表格变图表", "只读分析"))}.replace("只读分析", caption); }
if (!tables.length) {
  card.innerHTML = header("没找到表格") + '<div class="bee-body"><p>当前页面没有包含数值的表格。换一个有报表的页面再试。</p><button class="bee-btn" data-close2>关闭</button></div>';
  bee.on(card.querySelector("[data-close2]"), "click", function () { host.host && host.host.remove(); });
  bee.log("页面上没有可分析的表格");
  return "未找到表格";
}
const chosen = tables[0];
const rows = chosen.rows;
let labelIndex = 0;
let valueIndex = 1;
for (let column = 0; column < rows[0].length; column++) {
  const numericCells = rows.filter(function (row) { return number(row[column]) !== null; }).length;
  if (numericCells / rows.length > 0.6) { valueIndex = column; break; }
}
for (let column = 0; column < rows[0].length; column++) {
  if (column === valueIndex) continue;
  const textCells = rows.filter(function (row) { return row[column] && number(row[column]) === null; }).length;
  if (textCells / rows.length > 0.6) { labelIndex = column; break; }
}
const data = rows.map(function (row) { return { label: row[labelIndex] || "—", value: number(row[valueIndex]) }; })
  .filter(function (item) { return item.value !== null; })
  .sort(function (a, b) { return b.value - a.value; });
const max = Math.max.apply(null, data.map(function (item) { return Math.abs(item.value); }).concat([1]));
const palette = ["#f2ae2b", "#e08a00", "#c87f14", "#d9a02b", "#b8790a", "#e6b143"];
let bars = "";
data.slice(0, 14).forEach(function (item, index) {
  const width = Math.max(2, Math.round(Math.abs(item.value) / max * 100));
  bars += '<div style="margin:7px 0"><div style="display:flex;justify-content:space-between;font-size:10.5px;color:#6d5730;margin-bottom:3px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px">' + item.label + '</span><b style="font-weight:600;color:#8a5c00">' + item.value.toLocaleString("zh-CN") + '</b></div><div style="height:9px;border-radius:5px;background:#fff4d9;overflow:hidden"><div style="height:100%;width:' + width + '%;border-radius:5px;background:' + palette[index % palette.length] + '"></div></div></div>';
});
card.innerHTML = header("找到 " + data.length + " 行") +
  '<div class="bee-body"><div style="max-height:300px;overflow:auto">' + bars + '</div>' +
  '<div style="display:flex;gap:6px"><button class="bee-btn" id="csv" style="flex:1">复制 CSV</button><button class="bee-btn" id="close" style="flex:1">关闭</button></div></div>';
bee.on(card.querySelector("#close"), "click", function () { host.host && host.host.remove(); });
bee.on(card.querySelector("#csv"), "click", async function () {
  const csv = [rows[0].join(",")].concat(rows.slice(1).map(function (row) { return row.map(function (cell) { return '"' + cell.replace(/"/g, '""') + '"'; }).join(","); })).join("\\n");
  try { await navigator.clipboard.writeText(csv); card.querySelector("#csv").textContent = "已复制 " + rows.length + " 行"; }
  catch (error) { bee.log("复制失败：" + String(error)); }
});
bee.log("已分析表格：" + data.length + " 行数据");
return { rows: data.length, column: rows[0][valueIndex] };`
    }
  },
  {
    id: "tab-intel",
    emoji: "🗂️",
    title: "多标签页情报官",
    tagline: "一次看清所有标签页，按域名归类，还能跨标签页搜关键词。",
    highlight: "能力边界：一个微应用可以同时观察和操作多个标签页",
    tags: ["跨标签页", "信息整理", "省时间"],
    definition: {
      schemaVersion: 1,
      title: "多标签页情报官",
      description: "列出当前所有网页标签页，统计域名分布，支持跨标签页关键词搜索、复制全部链接。演示跨标签页观察能力。",
      kind: "panel",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const root = bee.mount(
  '<style>' +
  '.intel{display:flex;flex-direction:column;gap:9px}' +
  '.intel h2{margin:0;font-size:17px}' +
  '.intel .sum{font-size:11px;color:#8a7752;line-height:1.7}' +
  '.intel input{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #ead9b2;border-radius:6px;font:12px system-ui;color:#3a2a12;background:#fff}' +
  '.intel .acts{display:flex;gap:6px;flex-wrap:wrap}' +
  '.intel button{padding:5px 10px;border:1px solid #ead9b2;border-radius:5px;background:#fff;color:#6d5730;font-size:11px;cursor:pointer}' +
  '.intel button:hover{background:#fff8e4}' +
  '.intel .list{display:flex;flex-direction:column;gap:5px;max-height:270px;overflow:auto}' +
  '.intel .row{display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid #f0e3c4;border-radius:6px;background:#fffdf6;font-size:11px}' +
  '.intel .row.active{border-color:#e0c27a;background:#fff8e4}' +
  '.intel .row b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}' +
  '.intel .row small{color:#a08d64;font-size:9.5px;white-space:nowrap}' +
  '.intel .hit{padding:6px 8px;border-left:2px solid #f2ae2b;background:#fff8e4;font-size:10.5px;color:#6d5730;line-height:1.7;border-radius:0 5px 5px 0}' +
  '</style>' +
  '<div class="intel"><h2>🗂️ 多标签页情报官</h2><div class="sum" id="sum">读取标签页…</div>' +
  '<input id="q" placeholder="跨标签页搜索关键词，回车开始" />' +
  '<div class="acts"><button id="copy">复制全部链接</button><button id="refresh">刷新</button><button id="matches">只看匹配</button></div>' +
  '<div class="list" id="list"></div><output class="sum" id="out"></output></div>'
);
const list = root.querySelector("#list"), sum = root.querySelector("#sum"), out = root.querySelector("#out");
let tabs = [], onlyMatched = false, matched = new Set();
async function render() {
  try {
    tabs = await bee.tabs.list();
    const domains = {};
    for (const tab of tabs) { try { const host = new URL(tab.url).hostname; domains[host] = (domains[host] || 0) + 1; } catch (error) {} }
    const top = Object.entries(domains).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 4).map(function (item) { return item[0] + " ×" + item[1]; }).join("、");
    sum.textContent = "共 " + tabs.length + " 个网页标签页。" + (top ? "主要站点：" + top : "");
    list.innerHTML = "";
    const visible = onlyMatched ? tabs.filter(function (tab) { return matched.has(tab.id); }) : tabs;
    if (!visible.length) { list.innerHTML = '<div class="sum">没有匹配的标签页。</div>'; return; }
    for (const tab of visible.slice(0, 40)) {
      const row = document.createElement("div");
      row.className = "row" + (tab.active ? " active" : "");
      row.innerHTML = '<b></b><small></small>';
      row.querySelector("b").textContent = tab.title || tab.url;
      try { row.querySelector("small").textContent = new URL(tab.url).hostname; } catch (error) { row.querySelector("small").textContent = ""; }
      row.title = tab.url;
      list.append(row);
    }
  } catch (error) { sum.textContent = "读取失败：" + String(error); }
}
async function search() {
  const keyword = root.querySelector("#q").value.trim().toLowerCase();
  if (!keyword) return;
  out.textContent = "正在逐个观察标签页…";
  matched = new Set();
  list.innerHTML = "";
  let scanned = 0;
  for (const tab of tabs.slice(0, 8)) {
    try {
      const page = await bee.tabs.inspect(tab.id);
      scanned++;
      const text = String(page.text || "");
      const index = text.toLowerCase().indexOf(keyword);
      if (index < 0) continue;
      matched.add(tab.id);
      const snippet = text.slice(Math.max(0, index - 40), index + 80).replace(/\\s+/g, " ");
      const hit = document.createElement("div");
      hit.className = "hit";
      hit.textContent = (tab.title || tab.url) + "：" + snippet;
      list.append(hit);
    } catch (error) { out.textContent = "部分标签页无法观察：" + String(error); }
  }
  onlyMatched = true;
  out.textContent = "在 " + scanned + " 个标签页中找到 " + matched.size + " 个包含「" + keyword + "」的页面。";
}
bee.on(root.querySelector("#q"), "keydown", function (event) { if (event.key === "Enter") search(); });
bee.on(root.querySelector("#refresh"), "click", function () { onlyMatched = false; render(); });
bee.on(root.querySelector("#matches"), "click", function () { onlyMatched = !onlyMatched; render(); });
bee.on(root.querySelector("#copy"), "click", async function () {
  try { await navigator.clipboard.writeText(tabs.map(function (tab) { return tab.title + " " + tab.url; }).join("\\n")); out.textContent = "已复制 " + tabs.length + " 条链接。"; }
  catch (error) { out.textContent = "复制失败：" + String(error); }
});
await render();
return "标签页总览已就绪";`
    }
  },
  {
    id: "snippet-library",
    emoji: "💬",
    title: "我的私人短语库",
    tagline: "把常说的话存起来，搜索、复制，或一键填进当前网页的输入框。",
    highlight: "能力边界：完全按自己的习惯长出来，数据只存在本机",
    tags: ["个性化", "重复劳动", "跨页面"],
    definition: {
      schemaVersion: 1,
      title: "我的私人短语库",
      description: "保存常用回复/话术，支持搜索、复制、删除，并可以一键填入当前网页第一个空输入框。演示按个人习惯定制微应用。",
      kind: "panel",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const KEY = "snippets";
let items = (await bee.storage.get(KEY)) || [
  { id: "s1", text: "您好，问题已经收到，我们会在 24 小时内同步处理进展。", tag: "客服" },
  { id: "s2", text: "麻烦提供一下截图和复现步骤，我们马上排查。", tag: "客服" },
  { id: "s3", text: "本周进度：需求已评审，预计周四提测。", tag: "汇报" }
];
const root = bee.mount(
  '<style>' +
  '.snip{display:flex;flex-direction:column;gap:8px}' +
  '.snip h2{margin:0;font-size:17px}' +
  '.snip textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #ead9b2;border-radius:6px;font:12px/1.6 system-ui;color:#3a2a12;background:#fff;resize:vertical}' +
  '.snip .row{display:flex;gap:6px}' +
  '.snip input{flex:1;min-width:0;padding:7px 9px;border:1px solid #ead9b2;border-radius:6px;font:12px system-ui;color:#3a2a12;background:#fff}' +
  '.snip button{padding:6px 10px;border:1px solid #ead9b2;border-radius:5px;background:#fff;color:#6d5730;font-size:11px;cursor:pointer;white-space:nowrap}' +
  '.snip button.gold{background:linear-gradient(180deg,#ffc94d,#f2ae2b);border-color:#e0a01f;color:#33230a;font-weight:600}' +
  '.snip .list{display:flex;flex-direction:column;gap:6px;max-height:290px;overflow:auto}' +
  '.snip .card{padding:8px 9px;border:1px solid #f0e3c4;border-radius:7px;background:#fffdf6}' +
  '.snip .card p{margin:0 0 6px;font-size:11.5px;line-height:1.7;color:#3a2a12}' +
  '.snip .card .meta{display:flex;align-items:center;gap:6px;font-size:9.5px;color:#a08d64}' +
  '.snip .card .meta span{background:#fff2cc;border:1px solid #f2dfa6;color:#8a5c00;border-radius:3px;padding:1px 5px}' +
  '.snip .card .meta .sp{flex:1}' +
  '.snip output{font-size:11px;color:#8a7752;min-height:18px}' +
  '</style>' +
  '<div class="snip"><h2>💬 我的私人短语库</h2>' +
  '<textarea id="text" rows="3" placeholder="写一条常用回复或话术…"></textarea>' +
  '<div class="row"><input id="tag" placeholder="标签，例如 客服 / 汇报" /><button class="gold" id="add">保存</button></div>' +
  '<div class="row"><input id="q" placeholder="搜索短语" /></div>' +
  '<div class="list" id="list"></div><output id="out"></output></div>'
);
const list = root.querySelector("#list"), out = root.querySelector("#out");
function save() { return bee.storage.set(KEY, items); }
async function render() {
  const keyword = root.querySelector("#q").value.trim().toLowerCase();
  const visible = items.filter(function (item) { return !keyword || (item.text + " " + item.tag).toLowerCase().includes(keyword); });
  list.innerHTML = "";
  if (!visible.length) { list.innerHTML = '<div class="snip output" style="text-align:center;padding:16px 0">还没有短语，上面写一条保存吧。</div>'; return; }
  for (const item of visible) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<p></p><div class="meta"><span></span><i class="sp"></i><button data-copy>复制</button><button data-fill>填入网页</button><button data-del>删除</button></div>';
    card.querySelector("p").textContent = item.text;
    card.querySelector("span").textContent = item.tag || "未分类";
    bee.on(card.querySelector("[data-copy]"), "click", async function () {
      try { await navigator.clipboard.writeText(item.text); out.textContent = "已复制到剪贴板。"; }
      catch (error) { out.textContent = "复制失败：" + String(error); }
    });
    bee.on(card.querySelector("[data-del]"), "click", async function () { items = items.filter(function (entry) { return entry.id !== item.id; }); await save(); render(); out.textContent = "已删除。"; });
    bee.on(card.querySelector("[data-fill]"), "click", async function () {
      try {
        const tabs = await bee.tabs.list();
        const tab = tabs.find(function (entry) { return entry.active; }) || tabs[0];
        if (!tab) throw new Error("没有可操作的网页");
        const page = await bee.tabs.inspect(tab.id);
        const field = page.elements.find(function (element) { return ["input", "textarea"].includes(element.tag) && !element.readOnly && !element.disabled && element.visible && (element.type === null || !["checkbox", "radio", "file", "button", "submit"].includes(element.type)) && !element.value; });
        if (!field) throw new Error("这个页面上没找到空输入框");
        await bee.tabs.action({ tabId: tab.id, documentId: page.documentId, selector: field.selector, action: "fill", value: item.text });
        out.textContent = "已填入「" + (tab.title || tab.url) + "」的输入框。";
        bee.log("短语已填入网页：" + field.selector);
      } catch (error) { out.textContent = "填入失败：" + String(error); }
    });
    list.append(card);
  }
}
bee.on(root.querySelector("#add"), "click", async function () {
  const text = root.querySelector("#text").value.trim();
  if (!text) { out.textContent = "先写一条内容。"; return; }
  items.unshift({ id: String(Date.now()), text: text, tag: root.querySelector("#tag").value.trim() });
  root.querySelector("#text").value = ""; root.querySelector("#tag").value = "";
  await save(); await render(); out.textContent = "已保存到本机，共 " + items.length + " 条。";
});
bee.on(root.querySelector("#q"), "input", render);
await render();
return "短语库已就绪";`
    }
  },
  {
    id: "form-pipeline",
    emoji: "🏭",
    title: "跨页表单流水线",
    tagline: "在本地 QA 环境里创建店铺、完成入驻、填完三步客户表单，全程不提交。",
    highlight: "能力边界：真实业务页面上的多步骤操作，也可以沉淀成微应用",
    tags: ["业务流程", "跨页面", "本地演示"],
    definition: {
      schemaVersion: 1,
      title: "跨页表单流水线",
      description: "在 BeeHelper 本地测试站点（/demo.html）上读取已创建的 Shop，自动填写 Seller 入驻或客户三步表单，填完停下但不提交。需要先在 QA 测试工具里创建 Shop。",
      kind: "page",
      matches: ["*://127.0.0.1/*", "*://localhost/*"],
      trigger: "manual",
      code: `const sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
const shop = JSON.parse(localStorage.getItem("beehelper.lab.shop") || "null");
if (!shop) { bee.log("还没有 Shop，请先到 QA 测试工具创建"); return "missing-shop"; }
const view = new URLSearchParams(location.search).get("view") || "client";
function field(name) { return document.querySelector('[name="' + name + '"]'); }
function fill(name, value) { const element = field(name); if (element && !element.value) { bee.fill(element, value); return true; } return false; }
let filled = 0;
if (view === "seller") {
  filled += fill("shop_id", shop.id) ? 1 : 0;
  filled += fill("seller_email", "seller+" + String(shop.id).slice(-6) + "@example.com") ? 1 : 0;
  bee.log("Seller 入驻表单已填写 " + filled + " 项，未提交");
  return { view: view, filled: filled };
}
if (view === "client") {
  const steps = [
    { client_name: "QA_" + String(shop.id).slice(-6), email: "qa+" + Date.now() + "@example.com", phone: "13800138000", region: "SG" },
    { company_name: "BeeHelper QA Ltd", tax_number: "TAX-" + String(Date.now()).slice(-8), billing_address: "深圳市龙岗区吉华路 260 号", contact_name: "QA 同学" },
    { warehouse_code: "WH-" + String(shop.id).slice(-4), daily_orders: "120", shop_id: shop.id, notes: "由 BeeHelper 流水线填写，未提交" }
  ];
  for (let index = 0; index < steps.length; index++) {
    for (const key of Object.keys(steps[index])) {
      filled += fill(key, steps[index][key]) ? 1 : 0;
    }
    bee.log("第 " + (index + 1) + " 步已填写 " + filled + " 项");
    if (index < steps.length - 1) {
      const next = document.querySelector("#client-form button.primary");
      if (next) { next.click(); await sleep(220); }
    }
  }
  bee.log("三步表单已填完，共 " + filled + " 项；提交是不可逆操作，留给你确认");
  return { view: view, filled: filled, submitted: false };
}
bee.log("当前页面不是可识别的演示页面（" + view + "）");
return { view: view, filled: 0 };`
    }
  },
  {
    id: "color-audit",
    emoji: "🎨",
    title: "配色与对比度体检",
    tagline: "扫一遍页面的真实配色，找出对比度不足的文字，顺手给出调色建议。",
    highlight: "能力边界：把自己变成设计审查工具，也只用一个微应用",
    tags: ["设计工具", "无障碍", "数据采集"],
    definition: {
      schemaVersion: 1,
      title: "配色与对比度体检",
      description: "统计当前页面实际使用的文字色与背景色，按 WCAG 计算对比度，列出最需要修的可读性问题并给出可复制色值。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `function parse(color) {
  const match = /rgba?\\(([^)]+)\\)/.exec(color || "");
  if (!match) return null;
  const parts = match[1].split(",").map(function (value) { return parseFloat(value); });
  const alpha = parts.length > 3 ? parts[3] : 1;
  return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
}
function luminance(color) {
  const channel = function (value) { const v = value / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function backgroundOf(element) {
  let node = element;
  while (node && node !== document.documentElement) {
    const parsed = parse(getComputedStyle(node).backgroundColor);
    if (parsed && parsed.a > 0.6) return parsed;
    node = node.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}
const counts = new Map();
const problems = [];
let inspected = 0;
for (const element of Array.from(document.body.querySelectorAll("*")).slice(0, 2200)) {
  if (!element.getClientRects().length) continue;
  const style = getComputedStyle(element);
  const color = parse(style.color);
  if (!color) continue;
  inspected++;
  const key = style.color + "|" + style.backgroundColor;
  counts.set(key, (counts.get(key) || 0) + 1);
  const text = (element.textContent || "").trim();
  if (!text || text.length < 2 || element.children.length > 0) continue;
  const ratio = contrast(color, backgroundOf(element));
  const size = parseFloat(style.fontSize) || 14;
  const large = size >= 18.66 || (size >= 14 && Number(style.fontWeight) >= 700);
  if (ratio < (large ? 3 : 4.5)) problems.push({ ratio: ratio, color: style.color, background: style.backgroundColor, text: text.slice(0, 60), tag: element.tagName.toLowerCase() });
}
problems.sort(function (a, b) { return a.ratio - b.ratio; });
const palette = Array.from(counts.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
const hex = function (color) { const parsed = parse(color); if (!parsed) return color; return "#" + [parsed.r, parsed.g, parsed.b].map(function (value) { return Math.round(value).toString(16).padStart(2, "0"); }).join(""); };
const host = bee.mount(${JSON.stringify(UI)} +
  '<div class="bee-card">' + ${JSON.stringify(pageLayout("🎨 配色体检", "WCAG"))} +
  '<div class="bee-body">' +
  '<div style="display:flex;flex-wrap:wrap;gap:5px" id="swatches"></div>' +
  '<div class="bee-list" id="list"></div>' +
  '<div class="bee-note" id="out"></div>' +
  '</div></div>');
bee.cleanup(function () { host.host && host.host.remove(); });
const swatches = host.querySelector("#swatches"), list = host.querySelector("#list"), out = host.querySelector("#out");
for (const entry of palette) {
  const swatch = document.createElement("button");
  swatch.className = "bee-chip";
  swatch.style.background = entry[0].split("|")[0];
  swatch.style.color = "#fff";
  swatch.textContent = hex(entry[0].split("|")[0]) + " ×" + entry[1];
  bee.on(swatch, "click", async function () { try { await navigator.clipboard.writeText(hex(entry[0].split("|")[0])); out.textContent = "已复制 " + hex(entry[0].split("|")[0]); } catch (error) {} });
  swatches.append(swatch);
}
if (!problems.length) list.innerHTML = '<div class="bee-empty">这段页面文字对比度都达标，漂亮。</div>';
for (const item of problems.slice(0, 8)) {
  const row = document.createElement("div");
  row.className = "bee-row";
  row.style.flexDirection = "column";
  row.style.alignItems = "flex-start";
  row.innerHTML = '<div style="display:flex;gap:6px;width:100%;align-items:center"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid #0002"></span><b style="max-width:210px"></b><small></small></div>' +
    '<div class="bee-note" style="margin-top:2px"></div>';
  row.querySelector("span").style.background = item.color;
  row.querySelector("b").textContent = item.text;
  row.querySelector("small").textContent = item.ratio.toFixed(2) + ":1";
  row.querySelector("small").style.color = item.ratio < 3 ? "#b0452f" : "#b37700";
  row.querySelector(".bee-note").textContent = item.tag + " · 文字 " + hex(item.color) + " · 背景 " + hex(item.background);
  list.append(row);
}
out.textContent = "检查了 " + inspected + " 个元素，发现 " + problems.length + " 处文字对比度偏低。";
bee.log("配色体检完成：检查 " + inspected + " 个元素，问题 " + problems.length + " 处");
return { inspected: inspected, problems: problems.length };`
    }
  },
  {
    id: "quick-search",
    emoji: "⌘",
    title: "网页内命令面板",
    tagline: "按下快捷键，一屏搜索页面上的链接、按钮和输入框，回车直达。",
    highlight: "能力边界：给任何网站加一个它原本没有的交互层",
    tags: ["键盘流", "页面增强", "效率"],
    definition: {
      schemaVersion: 1,
      title: "网页内命令面板",
      description: "在当前页面唤出一个命令面板，模糊搜索所有链接、按钮与输入框，回车跳转或聚焦。演示给网站叠加自定义交互层。",
      kind: "page",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const items = [];
for (const element of document.querySelectorAll("a[href], button, input, textarea, select, [role=button], [contenteditable=true]")) {
  if (!element.getClientRects().length) continue;
  const label = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("title") || element.value || "").trim().replace(/\\s+/g, " ");
  if (!label || label.length > 90) continue;
  items.push({ element: element, label: label, tag: element.tagName.toLowerCase(), href: element.href || "" });
  if (items.length >= 400) break;
}
const host = bee.mount(
  '<style>' +
  '.palette{position:fixed;inset:0;z-index:2147483647;background:#2b1d0a55;backdrop-filter:blur(2px);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font:13px system-ui,"PingFang SC",sans-serif}' +
  '.palette-box{width:min(560px,92vw);background:#fffdf6;border:1px solid #e6c77d;border-radius:12px;box-shadow:0 24px 70px #3a2a1266;overflow:hidden}' +
  '.palette-search{display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid #f0e3c4;background:linear-gradient(180deg,#fffdf6,#fff8e6)}' +
  '.palette-search input{flex:1;border:0;background:transparent;font:15px system-ui;color:#3a2a12;outline:none}' +
  '.palette-search kbd{font:10px ui-monospace,monospace;border:1px solid #ead9b2;border-radius:4px;padding:2px 5px;color:#a08d64;background:#fff}' +
  '.palette-list{max-height:min(52vh,420px);overflow:auto}' +
  '.palette-row{display:flex;align-items:center;gap:9px;padding:9px 15px;border-bottom:1px solid #f7efd9;cursor:pointer}' +
  '.palette-row[data-active=true]{background:#fff4d6}' +
  '.palette-row .tag{font-size:9px;color:#8a5c00;background:#fff2cc;border:1px solid #f2dfa6;border-radius:3px;padding:1px 5px;min-width:52px;text-align:center}' +
  '.palette-row .label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3a2a12}' +
  '.palette-row .href{font-size:9px;color:#b3a179;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.palette-empty{padding:26px;text-align:center;color:#a08d64;font-size:11.5px}' +
  '.palette-foot{padding:7px 15px;font-size:10px;color:#a08d64;border-top:1px solid #f0e3c4;background:#fffbee;display:flex;gap:12px}' +
  '</style>' +
  '<div class="palette"><div class="palette-box">' +
  '<div class="palette-search"><span>⌘</span><input id="q" placeholder="搜索页面上的链接、按钮、输入框…" autofocus /><kbd>Esc</kbd></div>' +
  '<div class="palette-list" id="list"></div>' +
  '<div class="palette-foot"><span>↑↓ 选择</span><span>↵ 打开</span><span id="count"></span></div>' +
  '</div></div>'
);
const input = host.querySelector("#q"), list = host.querySelector("#list");
let filtered = items.slice(0, 60), cursor = 0;
function close() { host.host && host.host.remove(); bee.log("命令面板已关闭"); }
function activate(item) {
  if (!item) return;
  const element = item.element;
  if (item.href && element.tagName === "A") { element.click(); close(); return; }
  element.focus();
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  element.style.outline = "2px solid #f2ae2b";
  setTimeout(function () { element.style.outline = ""; }, 1600);
  close();
}
function render() {
  const keyword = input.value.trim().toLowerCase();
  filtered = items.filter(function (item) { return !keyword || (item.label + " " + item.href).toLowerCase().includes(keyword); }).slice(0, 60);
  cursor = 0;
  list.innerHTML = "";
  if (!filtered.length) { list.innerHTML = '<div class="palette-empty">没有匹配的内容</div>'; }
  filtered.forEach(function (item, index) {
    const row = document.createElement("div");
    row.className = "palette-row";
    row.dataset.active = String(index === cursor);
    row.innerHTML = '<span class="tag"></span><span class="label"></span><span class="href"></span>';
    row.querySelector(".tag").textContent = item.tag;
    row.querySelector(".label").textContent = item.label;
    row.querySelector(".href").textContent = item.href.replace(/^https?:\\/\\//, "");
    bee.on(row, "click", function () { activate(item); });
    list.append(row);
  });
  host.querySelector("#count").textContent = filtered.length + " / " + items.length + " 项";
}
bee.on(input, "input", render);
bee.on(document, "keydown", function (event) {
  if (event.key === "Escape") { close(); return; }
  if (!filtered.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    cursor = (cursor + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
    Array.from(list.children).forEach(function (row, index) { row.dataset.active = String(index === cursor); });
    list.children[cursor] && list.children[cursor].scrollIntoView({ block: "nearest" });
  }
  if (event.key === "Enter") { event.preventDefault(); activate(filtered[cursor]); }
}, { capture: true });
render();
setTimeout(function () { input.focus(); }, 30);
bee.log("命令面板已打开，共 " + items.length + " 个可交互元素");
return "命令面板已就绪";`
    }
  },
  {
    id: "plugin-factory",
    emoji: "✨",
    title: "一句话生成专属插件",
    tagline: "把你的重复劳动描述出来，AI 直接创建一个新的微应用候选。",
    highlight: "能力边界：微应用不只是执行者，也可以是新插件的产房",
    tags: ["AI 协作", "创造", "个性化"],
    definition: {
      schemaVersion: 1,
      title: "一句话生成专属插件",
      description: "描述你希望自动化的事情，调用已连接的 AI 创建一个新的微应用候选（不会修改当前微应用）。需要先在侧边栏连接 AI 客户端。",
      kind: "panel",
      matches: ["<all_urls>"],
      trigger: "manual",
      code: `const root = bee.mount(
  '<style>' +
  '.gen{display:flex;flex-direction:column;gap:9px}' +
  '.gen h2{margin:0;font-size:17px}' +
  '.gen p{margin:0;font-size:11.5px;color:#8a7752;line-height:1.7}' +
  '.gen textarea{width:100%;box-sizing:border-box;padding:9px;border:1px solid #ead9b2;border-radius:6px;font:12px/1.7 system-ui;color:#3a2a12;background:#fff;resize:vertical}' +
  '.gen .chips{display:flex;flex-wrap:wrap;gap:6px}' +
  '.gen .chips button{padding:4px 9px;border-radius:999px;border:1px solid #ead9b2;background:#fff8e4;color:#8a6410;font-size:11px;cursor:pointer}' +
  '.gen .go{padding:9px 12px;border:1px solid #e0a01f;border-radius:6px;background:linear-gradient(180deg,#ffc94d,#f2ae2b);color:#33230a;font-weight:600;cursor:pointer}' +
  '.gen output{min-height:20px;font-size:11.5px;color:#8a7752;line-height:1.7}' +
  '</style>' +
  '<div class="gen"><h2>✨ 一句话生成专属插件</h2>' +
  '<p>把你重复做的事写下来。AI 会新建一个微应用候选，而不是改这一个。</p>' +
  '<textarea id="need" rows="4" placeholder="例如：在我们公司的工单系统里，给工单号加一个一键复制按钮"></textarea>' +
  '<div class="chips">' +
  '<button data-fill="给公司内部工单系统加一个一键复制工单号的按钮">一键复制工单号</button>' +
  '<button data-fill="每天下午五点把当前页面的待办数量汇总成一句提醒">待办汇总提醒</button>' +
  '<button data-fill="把后台表格里的金额列自动求和并显示在页面顶部">金额自动求和</button>' +
  '</div>' +
  '<button class="go" id="make">生成新插件</button>' +
  '<output id="out"></output>' +
  '</div>'
);
const need = root.querySelector("#need"), out = root.querySelector("#out");
for (const chip of root.querySelectorAll("[data-fill]")) {
  bee.on(chip, "click", () => { need.value = chip.dataset.fill; need.focus(); });
}
bee.on(root.querySelector("#make"), "click", async () => {
  const requirement = need.value.trim();
  if (!requirement) { out.textContent = "先写一句你希望自动化什么。"; return; }
  out.textContent = "正在让 AI 创建新插件…";
  bee.log("请求生成新插件：" + requirement);
  try {
    await bee.askAI("请用 BeeHelper 的 microapp_create 新建一个微应用候选来满足下面的需求，不要修改当前微应用，也不要安装：" + requirement + "。创建后说明它的标题、适用页面和怎么运行。");
    out.textContent = "请求已交给 AI。它会在会话里新建一个候选，你可以在候选库里继续查看和试用。";
  } catch (error) {
    out.textContent = "呼叫 AI 失败：" + String(error) + "。请先在侧边栏连接一个 AI 客户端。";
  }
});
return "插件生成器已就绪";`
    }
  }
];
