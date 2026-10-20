import { applyOperation, type Database, type Definition } from "./model";

export const formSample: Definition = {
  schemaVersion: 1, title: "表单快速填写", description: "为当前页面的可见字段生成测试数据，不提交表单。",
  kind: "page", matches: ["http://localhost/*", "http://127.0.0.1/*"], trigger: "manual",
  code: `const values = {
  name: "QA_" + Math.random().toString(36).slice(2, 8),
  email: "qa+" + Date.now() + "@example.com",
  phone: "13800138000"
};
let count = 0;
for (const input of document.querySelectorAll("input, textarea, select")) {
  if (!input.getClientRects().length || input.disabled || input.readOnly) continue;
  if (input instanceof HTMLSelectElement) {
    const option = [...input.options].find(item => item.value && !item.disabled);
    if (option) { input.value = option.value; input.dispatchEvent(new Event("change", { bubbles: true })); count++; }
    continue;
  }
  if (["password", "hidden", "file", "submit", "button", "checkbox", "radio"].includes(input.type)) continue;
  const label = (input.name + " " + input.id + " " + input.type).toLowerCase();
  const value = label.includes("email") ? values.email : /phone|tel/.test(label) ? values.phone : input.type === "number" ? "100" : values.name;
  bee.fill(input, value);
  count++;
}
bee.log("已填写 " + count + " 个字段，未提交表单");
return { fieldsFilled: count, values };`
};
export const panelSample: Definition = {
  schemaVersion: 1, title: "批量文本整理", description: "去重、去空白并统计多行文本。", kind: "panel",
  matches: ["<all_urls>"], trigger: "manual",
  code: `const root = bee.mount(\`
  <h2>批量文本整理</h2>
  <label for="source">原始数据</label>
  <textarea id="source" rows="7" style="width:100%;padding:10px;border:1px solid #d8dfdb;border-radius:4px" placeholder="每行一条"></textarea>
  <div style="display:flex;gap:8px;margin:12px 0"><button id="process">去重并整理</button><span id="count"></span></div>
  <pre id="result" style="white-space:pre-wrap"></pre>
\`);
bee.on(root.querySelector("#process"), "click", () => {
  const values = [...new Set(root.querySelector("#source").value.split("\\n").map(line => line.trim()).filter(Boolean))];
  root.querySelector("#result").textContent = values.join("\\n");
  root.querySelector("#count").textContent = values.length + " 条";
  bee.log("已整理 " + values.length + " 条数据");
});`
};
export function createInitialDatabase(): Database {
  let db: Database = { version: 1, entries: [], runs: [], chat: [] };
  for (const definition of [panelSample, formSample]) db = applyOperation(db, { type: "create", definition, source: "内置样例" }).db;
  return db;
}
