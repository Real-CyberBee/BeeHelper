import { marked } from "marked";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const docs = path.join(root, "docs"), output = path.join(root, "site/docs");
let headingIds = new Map();
marked.use({ renderer: { heading({ tokens, depth, text }) {
  const base = text.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
  const count = headingIds.get(base) ?? 0; headingIds.set(base, count + 1);
  return `<h${depth} id="${base}${count ? `-${count}` : ""}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
} } });
const repository = "https://github.com/Real-CyberBee/BeeHelper/blob/main/";
const escape = text => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const navigation = [
  ["开始使用", [["index.html", "文档首页"], ["install.html", "下载与分平台安装"], ["releases/0.6.0.html", "v0.6.0 更新说明"], ["getting-started.html", "首次使用与 macOS 安装"]]],
  ["使用指南", [["agent-sessions.html", "连接与管理 AI Agent"], ["chat-interactions.html", "会话、附件与命令"], ["demos.html", "微应用示例画廊"], ["userscripts.html", "脚本市场与兼容性"]]],
  ["开发与排障", [["microapp-sdk.html", "微应用 SDK"], ["architecture.html", "架构说明"], ["local-testing.html", "本地开发与排障"], ["verification.html", "验证记录"], ["roadmap.html", "版本路线图"]]]
];
async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.name.endsWith(".md")) files.push(file);
  }
  return files;
}
const files = await filesIn(docs), targets = new Set(files.map(file => path.resolve(file)));
function shell({ title, body, filename, source }) {
  const relative = path.relative(path.dirname(filename), output).split(path.sep).join("/") || ".";
  const base = `${relative}/..`;
  const sidebar = navigation.map(([group, links]) => `<section><h2>${group}</h2>${links.map(([href, label]) => `<a href="${relative}/${href}"${filename === path.join(output, href) ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</section>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6c744"><title>${escape(title)} · BeeHelper 文档</title><link rel="icon" href="${base}/assets/cyberbee.png"><link rel="stylesheet" href="${base}/style.css"><link rel="stylesheet" href="${base}/docs.css"><script src="${base}/docs.js" defer></script></head><body><header class="header wrap"><a class="brand" href="${base}/index.html"><img src="${base}/assets/cyberbee.png" width="40" height="40" alt="CyberBee Logo"><span>BeeHelper<span class="byline">DOCUMENTATION</span></span></a><nav aria-label="主导航"><a href="${base}/index.html#downloads">下载</a><a href="${relative}/index.html">文档</a><a href="https://github.com/Real-CyberBee/BeeHelper">GitHub ↗</a></nav></header><div class="docs-layout wrap"><aside class="docs-sidebar"><details open><summary>文档导航</summary>${sidebar}</details></aside><main class="docs-main"><div class="doc-meta"><span>BeeHelper / 文档</span>${source ? `<a href="${repository}${source}">在 GitHub 查看原文 ↗</a>` : ""}</div><article>${body}</article><div class="doc-footer">遇到问题？<a href="https://github.com/Real-CyberBee/BeeHelper/issues">提交反馈 ↗</a><a href="${relative}/index.html">返回文档首页</a></div></main></div></body></html>`;
}
for (const file of files) {
  const relative = path.relative(docs, file), filename = path.join(output, relative.replace(/\.md$/, ".html"));
  const text = await readFile(file, "utf8"), title = text.match(/^# (.+)$/m)?.[1] ?? path.basename(file, ".md");
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, token => {
    if (!["link", "image"].includes(token.type) || /^(?:[a-z]+:|#|\/\/)/i.test(token.href)) return;
    const [href, hash] = token.href.split("#"), target = path.resolve(path.dirname(file), decodeURI(href));
    if (targets.has(target)) token.href = path.relative(path.dirname(filename), path.join(output, path.relative(docs, target).replace(/\.md$/, ".html"))).split(path.sep).join("/") + (hash ? `#${hash}` : "");
    else token.href = repository + path.relative(root, target).split(path.sep).join("/") + (hash ? `#${hash}` : "");
  });
  await mkdir(path.dirname(filename), { recursive: true });
  headingIds = new Map();
  await writeFile(filename, shell({ title, body: marked.parser(tokens), filename, source: "docs/" + relative.split(path.sep).join("/") }));
}
const introduction = `# BeeHelper 文档\n\n从安装到第一个微应用，再到连接本地 AI Agent。选择适合你的入口，跟着完成一次可验证的操作。\n\n> 当前下载版本：**0.6.0 公开预览版**。使用已有微应用不需要 AI；需要创作或修改时，再独立安装并登录 Agent。\n\n## 第一次使用\n\n- [下载与分平台安装](install.html)：Windows、Linux、macOS 的安装、修复、卸载与系统要求。\n- [首次使用向导](getting-started.html)：加载 Chrome 扩展，启用用户脚本，试用第一个微应用。\n- [示例画廊](demos.html)：从批量文本整理、表格转图表、页面批注等示例开始。\n\n## 把 AI 接进来\n\n- [连接与管理 AI Agent](agent-sessions.html)：Codex、Claude Code、DeepSeek Harness 的连接与会话。\n- [会话、附件与命令](chat-interactions.html)：文件、图片、斜杠命令、引用与发送策略。\n\n## 建立自己的工具箱\n\n- [脚本市场与兼容性](userscripts.html)：搜索和导入用户脚本，理解 GM API 的支持范围。\n- [微应用 SDK](microapp-sdk.html)：页面脚本、交互面板、存储与宿主能力。\n\n## 开发者与维护者\n\n- [架构说明](architecture.html) · [本地开发与排障](local-testing.html)\n- [验证记录](verification.html) · [版本路线图](roadmap.html)\n\n## 遇到连接问题\n\n先确认扩展已加载，再区分连接器缺失、Agent 未安装、Agent 未登录与模型额度等状态。阅读[安装排障](install.html#troubleshooting)，也可以导出脱敏诊断后[提交 Issue](https://github.com/Real-CyberBee/BeeHelper/issues)。\n`;
await writeFile(path.join(output, "index.html"), shell({ title: "文档中心", body: marked.parse(introduction), filename: path.join(output, "index.html") }));
console.log(`已生成文档中心：${files.length + 1} 个页面`);
