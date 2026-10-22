import { current, matchesUrl, type Database } from "./core/model";

let control: HTMLDivElement | undefined;
let lastUrl = "";
async function refresh() {
  const response = await chrome.runtime.sendMessage({ channel: "bee:request", type: "state" }).catch(() => null);
  const database = response?.data?.db as Database | undefined;
  if (!database) return;
  const count = database.entries.filter(entry => entry.installed && entry.enabled && current(entry).definition.matches.some(pattern => matchesUrl(pattern, location.href))).length;
  if (!count) { control?.remove(); control = undefined; return; }
  if (!control) {
    control = document.createElement("div");
    control.id = "beehelper-launcher";
    const root = control.attachShadow({ mode: "closed" });
    const button = document.createElement("button");
    button.title = "打开 BeeHelper";
    button.style.cssText = "all:initial;cursor:pointer;font:600 13px system-ui;color:#3a2a12;background:linear-gradient(180deg,#ffc94d,#f2ae2b);border:1px solid #e0a01f;border-radius:6px;padding:9px 12px;box-shadow:0 3px 14px #8a5c0040";
    button.addEventListener("click", () => { void chrome.runtime.sendMessage({ channel: "bee:request", type: "openPanel" }); });
    root.append(button);
    control.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647";
    document.documentElement.append(control);
    Object.assign(control, { updateLabel: (value: number) => { button.textContent = `🐝 BeeHelper · ${value}`; } });
  }
  (control as HTMLDivElement & { updateLabel: (value: number) => void }).updateLabel(count);
}
async function navigation() {
  if (lastUrl === location.href) return;
  lastUrl = location.href;
  await chrome.runtime.sendMessage({ channel: "bee:request", type: "pageReady", url: location.href }).catch(() => {});
  await refresh();
}
chrome.runtime.onMessage.addListener(message => { if (message.channel === "bee:event" && message.event?.type === "database") void refresh(); });
window.addEventListener("popstate", () => { void navigation(); });
void navigation();
