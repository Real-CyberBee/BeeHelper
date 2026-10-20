export interface InspectOptions { selector?: string; limit?: number }
export interface BrowserAction { tabId: number; documentId: string; selector: string; action: "click" | "fill" | "select"; value?: string }
type DocumentCommand =
  | { operation: "inspect"; selector: string | null; limit: number }
  | { operation: "action"; selector: string; action: BrowserAction["action"]; value: string | null };

// 注入函数必须自包含；页面与 Shadow DOM 共用同一套查找规则。
function browserDocument(command: DocumentCommand) {
  function descendants(scope: Document | Element): Element[] {
    const result: Element[] = [];
    const pending: Element[] = scope instanceof Element ? [scope] : [...scope.children].reverse();
    while (pending.length) {
      const element = pending.pop()!;
      result.push(element);
      pending.push(...[...element.children].reverse());
      if (element.shadowRoot) pending.push(...[...element.shadowRoot.children].reverse());
    }
    return result;
  }
  function locate(selector: string) {
    let matches: Element[];
    try { matches = descendants(document).filter(element => element.matches(selector)); }
    catch { throw new Error("无效 CSS selector，请使用 browser_inspect 返回的 selector"); }
    if (!matches.length) throw new Error("目标不存在，请重新观察页面；旧观察引用可能已失效");
    if (matches.length > 1) throw new Error("selector 匹配多个目标，请使用 browser_inspect 返回的唯一 selector");
    return matches[0] as HTMLElement;
  }
  if (command.operation === "action") {
    const element = locate(command.selector);
    if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") throw new Error("目标控件已禁用，未执行操作");
    if (!element.getClientRects().length) throw new Error("目标控件不可见，未执行操作");
    if (command.action === "click") element.click();
    else {
      if (command.value === null) throw new Error("fill/select 必须提供 value");
      if (element instanceof HTMLInputElement && element.type === "file") throw new Error("不支持用文件路径填写附件；当前没有内置文件上传工具");
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (command.action === "select") throw new Error("select 只适用于原生下拉框；自定义下拉请点击后重新观察选项");
        if (element.readOnly) throw new Error("目标控件只读，未执行填写");
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, command.value);
      } else if (element instanceof HTMLSelectElement) {
        if (![...element.options].some(option => option.value === command.value && !option.disabled)) throw new Error("下拉框中没有对应可用选项，请重新观察");
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, command.value);
      } else if (element.isContentEditable && command.action === "fill") element.textContent = command.value;
      else throw new Error("此控件不支持直接填写或 select；请点击后重新观察实际输入框/选项");
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
    return { done: true, action: command.action, url: location.href };
  }
  const scope = command.selector ? locate(command.selector) : document;
  const nodes = descendants(scope);
  const controls = nodes.filter(element => element.matches("input,textarea,select,button,a,[role=button],[role=combobox],[role=option],[role=checkbox],[role=radio],[contenteditable=true]"))
    .filter(element => element.getClientRects().length > 0 || element instanceof HTMLInputElement && element.type === "file");
  const snapshotId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const shadowRoots = nodes.flatMap(element => element.shadowRoot ? [element.shadowRoot] : []);
  const shadowText = shadowRoots.map(root => [...root.children].map(child => (child as HTMLElement).innerText ?? child.textContent ?? "").join("\n")).join("\n");
  return {
    url: location.href, title: document.title, snapshotId,
    text: ((scope instanceof HTMLElement ? scope.innerText : document.body?.innerText) ?? "").slice(0, 12_000) + "\n" + shadowText.slice(0, 6_000),
    openShadowRoots: shadowRoots.length, totalElements: controls.length, truncated: controls.length > command.limit,
    elements: controls.slice(0, command.limit).map((element, index) => {
      const ref = `${snapshotId}-b${index}`;
      (element as HTMLElement).dataset.beeRef = ref;
      const input = element as HTMLInputElement;
      const root = element.getRootNode();
      const label = element.getAttribute("aria-label") || input.labels?.[0]?.textContent?.trim() || element.textContent?.trim().slice(0, 120) || input.placeholder || "";
      return {
        ref, selector: `[data-bee-ref="${ref}"]`, tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"), label, name: input.name ?? null, type: input.type ?? null,
        value: ["password", "file"].includes(input.type) ? null : input.value ?? null,
        checked: ["checkbox", "radio"].includes(input.type) ? input.checked : element.getAttribute("aria-checked"),
        readOnly: Boolean(input.readOnly), required: Boolean(input.required),
        context: (element.closest("label")?.textContent || element.parentElement?.textContent || "").trim().slice(0, 180),
        disabled: Boolean(input.disabled) || element.getAttribute("aria-disabled") === "true",
        visible: element.getClientRects().length > 0, shadow: root instanceof ShadowRoot,
        options: element instanceof HTMLSelectElement ? [...element.options].slice(0, 100).map(option => ({ value: option.value, label: option.label, disabled: option.disabled })) : null,
        upload: input.type === "file" ? { accept: input.accept, multiple: input.multiple, fileCount: input.files?.length ?? 0 } : null
      };
    })
  };
}
export async function inspectPage(tabId: number, options: InspectOptions = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("请提供有效 tabId");
  const command: DocumentCommand = { operation: "inspect", selector: options.selector ?? null, limit: Math.max(1, Math.min(500, options.limit ?? 200)) };
  const [injection] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: browserDocument, args: [command] });
  if (!injection?.result || !("elements" in injection.result)) throw new Error("网页未返回观察结果");
  return { ...injection.result, documentId: injection.documentId, tabId };
}
export async function browserAction(args: BrowserAction) {
  if (!Number.isInteger(args.tabId) || args.tabId < 0 || !args.documentId || !args.selector) throw new Error("页面操作需要有效 tabId、documentId 和 selector");
  if (!["click", "fill", "select"].includes(args.action)) throw new Error("不支持的页面动作");
  if (args.action !== "click" && typeof args.value !== "string") throw new Error("fill/select 必须提供字符串 value");
  const command: DocumentCommand = { operation: "action", selector: args.selector, action: args.action, value: args.action === "click" ? null : args.value ?? null };
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: args.tabId, documentIds: [args.documentId] }, func: browserDocument, args: [command] });
  if (!injection?.result || !("done" in injection.result)) throw new Error("网页未返回操作结果，请重新观察页面");
  return injection.result;
}
