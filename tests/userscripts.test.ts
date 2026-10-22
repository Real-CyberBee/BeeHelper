import test from "node:test";
import assert from "node:assert/strict";
import { convertUserscript, parseUserscript, toChromePattern } from "../src/core/userscripts";
import { demos } from "../src/core/demos";
import { validateDefinition } from "../src/core/model";

const sample = `// ==UserScript==
// @name         Test Dark Mode
// @namespace    https://example.com/
// @version      1.2.3
// @description  Invert every site
// @author       bee
// @match        *://*.example.com/*
// @include      https://docs.example.org/*
// @exclude      *://*.example.com/private/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_getResourceText
// @require      https://cdn.example.com/lib.js
// @run-at       document-start
// ==/UserScript==

GM_addStyle("body{background:#000}");
GM_setValue("seen", 1);
bee.log("hi");
`;

test("解析用户脚本元数据块，保留多值与依赖声明", () => {
  const parsed = parseUserscript(sample);
  assert.equal(parsed.meta.name, "Test Dark Mode");
  assert.equal(parsed.meta.version, "1.2.3");
  assert.deepEqual(parsed.meta.matches, ["*://*.example.com/*"]);
  assert.deepEqual(parsed.meta.includes, ["https://docs.example.org/*"]);
  assert.deepEqual(parsed.meta.requires, ["https://cdn.example.com/lib.js"]);
  assert.ok(parsed.meta.grants.includes("GM_addStyle"));
  assert.ok(parsed.body.startsWith("GM_addStyle"));
  assert.throws(() => parseUserscript("bee.log(1)"), /UserScript/);
  assert.throws(() => parseUserscript("// ==UserScript==\n// @name x\n"), /元数据块/);
});

test("匹配规则转换成 Chrome match pattern，无法等价转换时明确跳过", () => {
  assert.equal(toChromePattern("*://*.example.com/*"), "*://*.example.com/*");
  assert.equal(toChromePattern("https://example.com"), "https://example.com/*");
  assert.equal(toChromePattern("https://example.com:8443/app/*"), "https://example.com/app/*");
  assert.equal(toChromePattern("example.com/path*"), "*://example.com/path*");
  assert.equal(toChromePattern("<all_urls>"), "<all_urls>");
  assert.equal(toChromePattern("/^https?:\\/\\/regex\\.com\\//"), null);
  assert.equal(toChromePattern("javascript:alert(1)"), null);
});

test("导入结果是不自动运行的候选，并带上 GM 兼容层与限制说明", () => {
  const converted = convertUserscript(sample, { source: "ScriptCat", pageUrl: "https://scriptcat.org/zh-CN/script-show-page/1", installs: 12345 });
  const definition = converted.definition;
  assert.equal(definition.kind, "page");
  assert.equal(definition.trigger, "manual");
  assert.deepEqual(definition.matches, ["*://*.example.com/*", "https://docs.example.org/*"]);
  assert.ok(definition.code.includes("GM_addStyle"));
  assert.ok(definition.code.includes("__beeExcluded"));
  assert.ok(definition.code.includes("GM_getResourceText 暂不支持"));
  assert.ok(definition.description.includes("ScriptCat"));
  assert.ok(definition.description.includes("@require"));
  assert.ok(definition.description.includes("GM_getResourceText"));
  assert.ok(converted.requires.includes("https://cdn.example.com/lib.js"));
  assert.doesNotThrow(() => validateDefinition(definition));
});

test("没有可用匹配范围的脚本拒绝导入，避免意外全站运行", () => {
  const noMatch = sample.replace(/\/\/ @(match|include)\s+.*\n/g, "");
  assert.throws(() => convertUserscript(noMatch), /没有可用的 @match/);
});

test("示例画廊的每个示例都是合法微应用，代码可编译且标识唯一", () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.ok(demos.length >= 10, "示例数量应该足够撑起画廊");
  assert.equal(new Set(demos.map(demo => demo.id)).size, demos.length);
  for (const demo of demos) {
    assert.doesNotThrow(() => validateDefinition(demo.definition), `示例 ${demo.id} 定义非法`);
    assert.ok(demo.tagline.length > 8, `示例 ${demo.id} 缺少一句话介绍`);
    assert.ok(demo.highlight.length > 4, `示例 ${demo.id} 缺少能力边界说明`);
    assert.doesNotThrow(() => new AsyncFunction("bee", demo.definition.code), `示例 ${demo.id} 源码语法错误`);
  }
});

test("示例覆盖面板、页面脚本与关键能力标签", () => {
  assert.ok(demos.some(demo => demo.definition.kind === "panel"));
  assert.ok(demos.some(demo => demo.definition.kind === "page"));
  assert.ok(demos.some(demo => demo.definition.code.includes("bee.askAI(")));
  assert.ok(demos.some(demo => demo.definition.code.includes("bee.apps.list(")));
  assert.ok(demos.some(demo => demo.definition.code.includes("bee.tabs.inspect(")));
});
