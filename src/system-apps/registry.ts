import type { ComponentType } from "react";
export interface SystemAppContext {
  request<T = any>(capability: string, data?: Record<string, unknown>): Promise<T>;
  close(): void;
}
export interface SystemApp {
  manifest: { id: string; title: string; version: number; builtin: true; uninstallable: false; capabilities: readonly string[] };
  load(): Promise<{ default: ComponentType<{ context: SystemAppContext }> }>;
}
export const setupApp: SystemApp = {
  manifest: { id: "beehelper.setup", title: "首次使用与诊断", version: 1, builtin: true, uninstallable: false,
    capabilities: ["setupSnapshot", "setupComplete", "sessionNew", "connect", "openExtensionDetails", "openInstallGuide"] },
  load: () => import("./SetupApp")
};
export const systemApps: readonly SystemApp[] = [setupApp];
export function systemAppContext(app: SystemApp, request: SystemAppContext["request"], close: () => void): SystemAppContext {
  return { close, request: (capability, data) => {
    if (!app.manifest.capabilities.includes(capability)) return Promise.reject(new Error("内置微应用未声明此能力"));
    return request(capability, data);
  } };
}
