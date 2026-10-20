import { useEffect, useRef, useState } from "react";
import { request } from "../client";
import { emptyDraft, type ChatDraft } from "../core/chat-content";
import type { ChatSession } from "../core/sessions";

export function useChatDrafts(session: ChatSession | undefined, onError: (message: string) => void) {
  const entries = useRef(new Map<string, { value: ChatDraft; updatedAt: number }>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const writes = useRef(new Map<string, Promise<unknown>>());
  const [, render] = useState(0);
  if (session && !entries.current.has(session.id)) entries.current.set(session.id, { value: session.draft ?? emptyDraft(), updatedAt: session.draftUpdatedAt ?? 0 });
  const persist = (id: string) => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id);
    const item = entries.current.get(id);
    if (!item) return Promise.resolve();
    const value = structuredClone(item);
    const previous = writes.current.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => request("sessionDraft", { sessionId: id, draft: value.value, updatedAt: value.updatedAt }));
    writes.current.set(id, next);
    void next.catch(error => onError(String(error)));
    return next;
  };
  const update = (id: string, change: ChatDraft | ((draft: ChatDraft) => ChatDraft), immediate = false) => {
    const current = entries.current.get(id)?.value ?? emptyDraft();
    entries.current.set(id, { value: typeof change === "function" ? change(current) : change, updatedAt: Date.now() });
    render(value => value + 1);
    clearTimeout(timers.current.get(id));
    if (immediate) void persist(id);
    else timers.current.set(id, setTimeout(() => { void persist(id); }, 200));
  };
  useEffect(() => {
    if (!session) return;
    const local = entries.current.get(session.id);
    if (local && (session.draftUpdatedAt ?? 0) > local.updatedAt) {
      entries.current.set(session.id, { value: session.draft ?? emptyDraft(), updatedAt: session.draftUpdatedAt ?? 0 });
      render(value => value + 1);
    }
  }, [session?.id, session?.draftUpdatedAt]);
  useEffect(() => {
    const flush = () => { for (const id of timers.current.keys()) void persist(id); };
    window.addEventListener("pagehide", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); };
  }, []);
  return {
    draft: session ? entries.current.get(session.id)?.value ?? emptyDraft() : emptyDraft(),
    get: (id: string) => entries.current.get(id)?.value ?? emptyDraft(),
    update, flush: persist,
    clearIfUnchanged(id: string, snapshot: ChatDraft) {
      if (JSON.stringify(entries.current.get(id)?.value) === JSON.stringify(snapshot)) update(id, emptyDraft(), true);
    }
  };
}
