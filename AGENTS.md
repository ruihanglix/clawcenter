# AGENTS.md - ClawCenter (dispatch)

## Project Overview

ClawCenter is a TypeScript central router/dispatcher bridging multiple WeChat accounts
to multiple AI agents (Claude Code, OpenCode, CodeBuddy, Codex, etc.). It has two
operational modes: **center** (dispatcher + WeChat connector + worker hub) and **worker**
(connects to a center, runs local agents). The codebase includes a Node.js backend
(`src/`) and a React web management panel (`web/`).

## Build / Run / Test Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Full build: compile server (`tsc`) + build web frontend (Vite) |
| `npm run build:server` | Server only: `tsc` |
| `npm run build:web` | Web frontend only: `vite build --config web/vite.config.ts` |
| `npm run typecheck` | Type-check without emitting: `tsc --noEmit` |
| `npm run dev` | Dev server with hot reload: `tsx src/index.ts start` |
| `npm run dev:worker` | Dev worker mode: `tsx src/index.ts start --worker` |
| `npm run start` | Production: `node dist/index.js start` |

**Testing:** No test framework is configured. There are no test files or test runner.
If you add tests, Vitest is the recommended choice given the Vite-based web frontend.

**Linting/Formatting:** No linter or formatter is configured. Follow the conventions
described below to maintain consistency.

**Always run `npm run typecheck` after making changes** to verify there are no type errors.

## Tech Stack

- **Runtime:** Node.js >= 22, ESM modules (`"type": "module"`)
- **Language:** TypeScript with strict mode enabled
- **Server:** Fastify, Commander (CLI), ws (WebSocket)
- **Frontend:** React 19 + Vite + React Router DOM
- **Database:** sql.js (SQLite in-process WASM)
- **Validation:** Zod
- **TUI:** Ink + React (terminal UI)
- **AI SDKs:** `@anthropic-ai/claude-agent-sdk`

## Project Structure

```
src/
  index.ts              # CLI entry (Commander)
  server.ts             # Fastify server bootstrap
  logger.ts             # Logging utilities
  core/
    agents/             # Agent adapters (one file per agent type)
      adapter.ts        # AgentAdapter interface + shared types
      manager.ts        # Agent lifecycle management
    api/routes.ts       # All REST API route definitions
    db/
      schema.ts         # SQLite schema + defaults
      store.ts          # Data access layer (all CRUD)
  center/
    dispatcher.ts       # Message dispatch orchestration
    hub.ts              # WebSocket server for remote workers
    router/             # Routing engine + hashtag parser
    commands/           # System slash commands
    wechat/             # WeChat API client, connector, login, CDN
  worker/client.ts      # Worker WebSocket client
  tui/                  # Terminal UI (Ink/React)
web/                    # Separate Vite sub-project (management panel)
  src/
    pages/              # One component per page (Dashboard, Settings, etc.)
```

## Code Style Guidelines

### Formatting

- **Indentation:** 2 spaces (no tabs)
- **Quotes:** Double quotes `"` everywhere (strings, imports, JSX attributes)
- **Semicolons:** Always required
- **Trailing commas:** Yes, in multi-line constructs (function params, objects, arrays)
- **Braces:** Same-line opening brace (K&R style)
- **Line length:** Aim for ~100-120 characters; no strict limit enforced

### Imports

- Use **ESM imports** with `.js` extension on all local imports (required for ESM):
  ```typescript
  import { Store } from "./core/db/store.js";
  ```
- **Ordering** (not strictly enforced, but preferred):
  1. Node.js built-ins (`node:path`, `node:fs`, `node:crypto`)
  2. Third-party packages (`fastify`, `zod`, `ws`)
  3. Local/relative imports (`./core/db/store.js`)
- Use `import type` or inline `type` keyword for type-only imports:
  ```typescript
  import type { FastifyInstance } from "fastify";
  import { Store, type Database } from "./core/db/store.js";
  ```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files (non-component) | kebab-case | `claude-code.ts`, `system-commands.ts` |
| React component files | PascalCase | `App.tsx`, `Dashboard.tsx` |
| Classes | PascalCase | `AgentManager`, `WechatConnector` |
| Interfaces / Types | PascalCase | `ServerOptions`, `AgentConfig` |
| Functions / variables | camelCase | `startServer`, `agentManager` |
| Module-level constants | UPPER_SNAKE_CASE | `MAX_CONSECUTIVE_FAILURES`, `SCHEMA_SQL` |
| Boolean variables | `is`/`has` prefix | `isRunning`, `hasDefault` |
| Database columns | snake_case | `wechat_id`, `created_at` |
| Private class members | `private` keyword, no prefix | `private db`, `private running` |

### Types

- **Strict mode is enabled** -- do not add `// @ts-ignore` or `// @ts-nocheck`.
- Prefer `interface` for object shapes, `type` for unions and function signatures:
  ```typescript
  interface AgentConfig { model?: string; workDir?: string; }
  type AgentType = "claude-code" | "claude-sdk" | "opencode";
  type WorkerSendFn = (agentId: string, params: SendParams) => Promise<SendResult>;
  ```
- **Avoid `any`** -- use `unknown` for truly unknown values, `Record<string, unknown>`
  for untyped objects. The codebase has ~10 `any` usages, all for parsing untyped
  external JSON.
- Annotate function parameters and return types explicitly.
- Use Fastify generics for route typing:
  ```typescript
  app.post<{ Body: { id: string; name: string } }>("/api/...", async (req) => { ... });
  ```

### Exports

- **Named exports only** -- no default exports (except `web/vite.config.ts` as required by Vite).
- One class/module per file. Private helpers are unexported functions at file bottom.

### Error Handling

- Use `try/catch` with `(err as Error).message` for error access (TypeScript catch is `unknown`):
  ```typescript
  try {
    await adapter.start(config);
  } catch (err) {
    logger.error(`Failed: ${(err as Error).message}`);
    throw err;
  }
  ```
- Use custom error classes with `instanceof` checks where needed:
  ```typescript
  export class PermissionError extends Error {
    constructor(public readonly agentId: string, public readonly allowedAgents: string[]) {
      super(`No permission to access agent "${agentId}"`);
      this.name = "PermissionError";
    }
  }
  ```
- Silent catch is acceptable for non-critical operations (add a comment explaining why):
  ```typescript
  try { this.db.run(sql); } catch { /* column already exists */ }
  ```
- API routes return errors as `reply.code(400).send({ error: (err as Error).message })`.

### Comments

- Comments are sparse and practical -- don't over-comment obvious code.
- Use section dividers for logical groupings in large files:
  ```typescript
  // ─── Settings ───
  ```
- Use `/** */` doc comments for public API methods that need explanation.
- Use numbered step comments for multi-step logic:
  ```typescript
  // 1. System command?
  // 2. Parse #hashtag
  // 3. Reply-based routing
  ```

### Patterns to Follow

- **EventEmitter** for cross-component communication (`AgentManager`, `Dispatcher` extend EventEmitter)
- **Adapter pattern** for agents -- each agent type implements the `AgentAdapter` interface from `adapter.ts`
- **Single store** -- all database access goes through the `Store` class in `core/db/store.ts`
- **All API routes** are registered in a single `registerApiRoutes()` function in `core/api/routes.ts`
- Database field names stay snake_case even in TypeScript interfaces (matching SQL schema)
- Use `??` (nullish coalescing) and `?.` (optional chaining) liberally
