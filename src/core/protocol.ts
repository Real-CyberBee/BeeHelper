export const HOST_NAME = "io.beehelper.codex";
export interface TargetTab { id: number; title: string; url: string; active?: boolean }
export interface ConnectorStatus { connected: boolean; ready?: boolean; busy?: boolean; version?: string; authenticated?: boolean; error?: string }
export interface Envelope<T = unknown> { ok: boolean; data?: T; error?: string }
export interface NativeMessage { kind: string; id?: string; result?: unknown; error?: string; name?: string; args?: unknown; event?: Record<string, unknown>; sessionId?: string; connectionId?: string }
