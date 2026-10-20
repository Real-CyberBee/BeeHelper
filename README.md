# BeeHelper

English | [简体中文](README.zh-CN.md)

An AI microapp workbench in the browser sidebar. Inspired by Tampermonkey's scripting freedom and the everything-is-a-plugin architecture, BeeHelper lets you create, preview, install, and refine browser microapps through external coding agents. Local adapters connect Codex, Claude Code, and DeepSeek Harness.

## What's New in 0.3.0

- A searchable `/` command palette with keyboard selection, actual ACP commands, Codex compaction, and BeeHelper session controls.
- `@` references for microapps, open pages, and Codex skills; local files can be selected as explicit attachments.
- File selection, drag-and-drop, browser clipboard files/images, previews, downloads, upload progress, and persistent rich drafts.
- Structured image inputs, embedded text resources when supported, and local file references for other formats.
- Markdown tables and code blocks, copy/reuse actions, message search, conversation export, and configurable send keys.
- Agent-provided session settings, including ACP modes and Codex reasoning effort, without pretending all clients expose the same controls.

This is not a one-to-one terminal/desktop-client clone. Command and image support is capability-gated; binary file references do not mean a document has already been parsed. See [Chat Interactions and Attachments](docs/chat-interactions.md) (Chinese) for limits, privacy, and adapter behavior.

### Earlier 0.2.0 Session Management

- Persistent conversations with search, switching, renaming, archiving, and restoration.
- A durable follow-up queue, cancellation, and capability-gated steering during a running task.
- Per-session model selection, with requested and confirmed models tracked separately.
- Pluggable Codex App Server and ACP adapters, with session-scoped MCP tools and permission prompts.
- Automatic migration of existing chat history without clearing other conversations.

WorkBuddy installation is detected, but its desktop login is **not** treated as an API connection. WorkBuddy's official Open API needs a separate authorized adapter and is not implemented in this version. An independently installed CodeBuddy CLI is a separate ACP candidate, not a substitute for WorkBuddy desktop sessions. See [Agent Sessions and Plugins](docs/agent-sessions.md) (Chinese) for setup, capabilities, and limitations.

### Earlier 0.1.1 Fixes

Fixes page-action argument serialization, adds observation and interaction inside open Shadow DOM, and improves agent capability discovery, selected-microapp context, target-page context, and run-log lookup errors.

To upgrade, stop in-flight tasks, reload BeeHelper at `chrome://extensions/`, reopen the sidebar, and reconnect Codex. Do not uninstall the extension: reloading preserves the local library and saved chat. Re-registering the native connector is not necessary unless its paths have changed. See the [fix notes](docs/fixes/2026-10-19-context.md) (Chinese).

## Run Locally

The primary interface is the **native Chrome side panel**, opened from the extension toolbar icon or a microapp's in-page shortcut. Full-tab and web previews are auxiliary debugging surfaces, not replacements for the extension sidebar.

Requirements: Chrome 138+, Node.js 22.12+, and at least one installed, configured local agent (Codex CLI, Claude Code, or dsh). dsh uses its own compatible Node runtime. The prototype has been verified on macOS. The native connector installer includes Linux paths, but Linux has not been verified on a real machine; Windows installation is not supported.

From a fresh checkout:

```sh
npm ci
npm run build
npm run setup:native
npm run dev
```

1. Open `chrome://extensions/` and enable Developer mode.
2. Choose **Load unpacked** and select the generated `dist/` directory.
3. Open BeeHelper's extension details and enable **Allow User Scripts**.
4. Click the BeeHelper toolbar icon to open the sidebar.
5. Select an agent in **AI 会话**, create a conversation, and connect it. Existing conversations remain available.

`npm run dev` starts the local demo server. Use the address printed by Vite; the default test page is `http://127.0.0.1:4173/demo.html`. No demo server is needed when using the built extension on other websites.

## Current Features

- Preview candidate microapps without installing them, then install directly into the local library.
- Search, favorites, source editing, revision history and restoration, import, and export.
- Page scripts, sandboxed interactive panels, cross-tab observation and actions, and microapp-private storage.
- Page-match activation, SPA navigation handling, event registration, and resource cleanup.
- Codex App Server and ACP + MCP + Native Messaging connections, without a custom agent loop.
- Agent-driven edits to BeeHelper-managed source; users do not need a separate code project.

This is a local validation prototype, not a production release. It has no real business-system integrations and does not promise arbitrary npm-package support, universal browser compatibility, or extension-store approval. Switching agents creates separate native sessions; it does not transfer opaque execution state between products.

## Verification

```sh
npm run check
npm test
npm run test:e2e
npm run doctor
```

E2E tests use a separate Chromium profile, not your personal Chrome pages or cookies. Set `CHROME_PATH` to choose a test browser, or run `npx playwright install chromium` if one is missing. Model-backed tests require explicit opt-in:

```sh
BEEHELPER_LIVE_CODEX=1 npm run test:e2e
```

These tests consume the signed-in Codex account's model quota. Default E2E tests verify the real connection and local execution without sending model requests.

## Documentation

Detailed project documents are currently in Chinese:

- [Product Scope](docs/product.md)
- [Architecture Draft](docs/architecture.md)
- [Runtime and Agent Research](docs/research/README.md)
- [Multi-Agent Session Management Research](docs/research/session-management.md)
- [Agent Sessions and Plugin Development](docs/agent-sessions.md)
- [Chat Interactions and Attachments](docs/chat-interactions.md)
- [Local Testing and Troubleshooting](docs/local-testing.md)
- [Microapp Format and SDK](docs/microapp-sdk.md)
- [Verification Notes](docs/verification.md)

## First Validation Scenario

Create a shop in a synthetic local QA tool, complete seller onboarding, and fill a three-step client form. All demo data stays in the local test website.

Microapp authors refine business rules through conversation with AI; those rules are not hardcoded into the BeeHelper platform.

## Public Repository and Local Data

This repository contains source code, synthetic test fixtures, and documentation. It excludes browser sessions, microapp libraries, chat history, business data, and Codex credentials. `.local/`, dependencies, build output, and test reports are not committed; build the extension and register the native connector on each new machine. The manifest's `key` is a **public key** used to keep the development extension ID stable, not a private key.

Do not commit `.env`, `.npmrc`, private keys, personal browser profiles, or real business microapp exports. Before sharing a microapp, check its source for credentials, internal URLs, and business data.
