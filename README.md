# BeeHelper

English | [简体中文](README.zh-CN.md)

An AI microapp workbench in the browser sidebar. Inspired by Tampermonkey's scripting freedom and the everything-is-a-plugin architecture, BeeHelper lets you create, preview, install, and refine browser microapps through external coding agents. Local adapters connect Codex, Claude Code, and DeepSeek Harness.

## What's New in 0.4.0

- **Honey-yellow light theme.** A warm, low-glare palette for the sidebar, the in-page launcher, the panel sandbox and the local demo site. The logo and extension icons come from the company site [cyberbee.top](https://cyberbee.top) (`/logo/bee-96.png`, `/logo/bee-512.png`); derived icons live in `public/icons/`.
- **Script market for the Tampermonkey ecosystem.** Search popular scripts on ScriptCat (default; usually reachable from mainland China) and GreasyFork, preview install counts, and import a script as a **candidate microapp** – source visible, editable, trialable. Details and limits: [Userscripts](docs/userscripts.md).
- **A real conversion layer.** `// ==UserScript==` metadata is parsed, `@match`/`@include` become match patterns, `@exclude` becomes an in-page guard, and a GM compatibility bridge maps common `GM_*` APIs onto the `bee` SDK. Imports default to manual runs and are never installed automatically.
- **AI can search the ecosystem.** New agent tools `userscript_search` and `userscript_import`, registered in the MCP tool list and the capability manifest, so the model can find existing scripts, explain trade-offs, and import only after you choose.
- **Demo gallery with 13 runnable examples**, including AI rewriting its own microapp, a "plugin hub" where microapps run other microapps, a page annotation pen, table-to-chart, a reader mode, a cross-tab intel panel and a personal phrase library. See [Demo Gallery](docs/demos.md).
- **New host capabilities.** Microapps can call `bee.apps.list()/run()/update()` and `bee.askAI(prompt)`; the latter hands a request to the connected session with the current microapp attached as a reference, so the AI can modify it. Host-capability calls are written to run logs.
- **Verification.** Unit tests now cover metadata parsing, pattern conversion, GM bridge generation, import limits, and every demo definition (including compiling each demo script).

### Earlier 0.3.0 Rich Chat Interactions

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

Requirements: Chrome 138+, Node.js 22.12+, and at least one installed, configured local agent (Codex CLI, Claude Code, or dsh). dsh uses its own compatible Node runtime. The prototype has been verified on macOS and on Linux (Chrome 152, with Claude Code 2.1 and DeepSeek Harness 0.2 connected over ACP); Windows native-messaging installation is not implemented.

After `npm run setup:native`, **fully restart the browser** (reloading the extension is not enough): Chrome reads Native Messaging manifests at startup. If the default client (Codex) is not installed, pick Claude Code or DSH in the new-chat selector; the sidebar now defaults to an available client on its own.

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
- A script market for Tampermonkey-ecosystem userscripts (ScriptCat / GreasyFork / local `.user.js`) with metadata conversion and a GM compatibility bridge.
- A demo gallery of 13 runnable microapps, plus host capabilities that let a microapp run other microapps (`bee.apps`) or ask the connected AI to modify it (`bee.askAI`).
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

E2E tests use a separate Chromium profile, never your personal pages or cookies. The harness runs on **Linux, macOS and Windows**: it resolves `CHROME_PATH` first, then the Playwright-managed Chromium, then the platform browser cache (`~/.cache/ms-playwright`, `~/Library/Caches/ms-playwright`, `%LOCALAPPDATA%\ms-playwright`). Runs are headless by default; set `E2E_HEADED=1` to watch them.

By default the suite installs a fixture Native Messaging host backed by the repository's fake ACP agent, so no local connector or model quota is needed. Real connector and model tests are opt-in:

```sh
# Real connector; run `npm run setup:native` and sign in to Codex first.
BEEHELPER_E2E_CONNECTOR=1 npm run test:e2e

# Add real model requests; consumes Codex quota.
BEEHELPER_E2E_CONNECTOR=1 BEEHELPER_LIVE_CODEX=1 npm run test:e2e
```

On Windows the extension/UI cases run, while the fixture Native Messaging suite is skipped: Chrome on Windows requires a compiled `.exe` host instead of a shell wrapper.

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
- [Tampermonkey Ecosystem and Userscript Import](docs/userscripts.md)
- [Demo Gallery](docs/demos.md)
- [Verification Notes](docs/verification.md)

## First Validation Scenario

Create a shop in a synthetic local QA tool, complete seller onboarding, and fill a three-step client form. All demo data stays in the local test website.

Microapp authors refine business rules through conversation with AI; those rules are not hardcoded into the BeeHelper platform.

## Public Repository and Local Data

This repository contains source code, synthetic test fixtures, and documentation. Brand assets under `public/logo/` and derived extension icons under `public/icons/` come from the company site [cyberbee.top](https://cyberbee.top). It excludes browser sessions, microapp libraries, chat history, business data, and Codex credentials. `.local/`, dependencies, build output, and test reports are not committed; build the extension and register the native connector on each new machine. The manifest's `key` is a **public key** used to keep the development extension ID stable, not a private key.

Do not commit `.env`, `.npmrc`, private keys, personal browser profiles, or real business microapp exports. Before sharing a microapp, check its source for credentials, internal URLs, and business data.
