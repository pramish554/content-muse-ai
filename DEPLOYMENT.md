# Deployment Guide

## Architecture Overview

This project is a **TanStack Start v1** full-stack application built with **Vite 7**. It deploys as a single Cloudflare Worker that bundles both the React frontend and all server-side logic (RPC functions + HTTP routes) into one edge-deployable unit.

There is no separate backend service to deploy. The "backend" is co-located with the frontend code and extracted at build time by TanStack's Vite plugins.

---

## How Server Code Is Bundled

### 1. Server Functions (`createServerFn`)

Server functions are defined in files matching `*.functions.ts` (e.g. `src/lib/workspaces.functions.ts`).

- **What happens at build time:** TanStack's server-fn Vite plugin scans these files, extracts the `.handler()` bodies, and generates RPC stubs. The heavy server logic is stripped from the client bundle and replaced with a lightweight fetch call.
- **Runtime behavior:** When the client calls a server function, it makes an HTTP POST request to an internal RPC endpoint. The Worker runs the actual handler, which can access secrets, databases, and Node.js-compatible APIs.
- **Where to place them:** `src/lib/*.functions.ts` or co-located next to the component that uses them. Do **not** put them under `src/server/` — that directory is blocked from client imports and will break component imports.

### 2. Server Routes (Raw HTTP Endpoints)

Server routes are defined with `createFileRoute` inside files under `src/routes/api/` (e.g. `src/routes/api/public/publish-scheduled.ts`).

- **What happens at build time:** The TanStack Router Vite plugin registers these as actual HTTP route handlers on the Worker.
- **Runtime behavior:** They receive raw `Request` objects and return `Response` objects. Use these for webhooks, cron jobs, public APIs, and file uploads.
- **Public routes:** Any route under `/api/public/*` bypasses Lovable's published-site auth and is reachable by external services (e.g. Stripe webhooks, pg_cron).

### 3. Server-Only Helpers (`*.server.ts`)

Shared logic used by handlers (database queries, API clients, business logic) lives in `*.server.ts` files.

- **What happens at build time:** Vite's import analysis blocks any file matching `**/*.server.*` from the client bundle automatically.
- **Where to place them:** `src/lib/*.server.ts` or any module path that is only imported by `.functions.ts` files or route handlers.
- **Safe patterns:** Keep `.functions.ts` files as thin wrappers. Move helper functions, configs, and schemas into imported `.server.ts` modules to avoid `ReferenceError` from sibling declarations in split server-fn modules.

---

## Where to Place Files

| Concern | Location | Rule |
|---|---|---|
| React pages & layouts | `src/routes/*.tsx` | File-based routing. Dots become slashes. |
| Server RPC functions | `src/lib/*.functions.ts` | Safe to import from components. |
| Server-only helpers | `src/lib/*.server.ts` | Blocked from client bundles automatically. |
| Public HTTP endpoints | `src/routes/api/public/*.ts` | Raw `Request` / `Response` handlers. |
| Internal HTTP endpoints | `src/routes/api/*.ts` | Same as public, but behind auth. |
| Components | `src/components/*.tsx` | Reusable UI. |
| Hooks | `src/hooks/*.ts` | Client-side React hooks. |
| Styles / tokens | `src/styles.css` | Tailwind v4 with CSS-native theming. |
| Database migrations | `supabase/migrations/*.sql` | Applied automatically on deploy. |

---

## Environment Variables

| Variable | Prefix | Where to read | Example |
|---|---|---|---|
| Public config | `VITE_` | Client + Server | `import.meta.env.VITE_SUPABASE_URL` |
| Secrets | *(none)* | Server-only boundary | `process.env.SUPABASE_SERVICE_ROLE_KEY` |

**Critical:** Never read `process.env.*` at module scope in a file that could be imported by client code. Always read secrets inside the `.handler()` body of a `createServerFn` or inside a server route handler.

---

## Step-by-Step Deployment

### Step 1 — Verify Build Locally

```bash
bun run build
```

This produces a production bundle in the `.output/` directory. If the build fails with an unresolved import or a TypeScript error, fix it before deploying.

### Step 2 — Check Migrations

Database migrations in `supabase/migrations/` are applied automatically when you deploy. Review them to ensure:

- Every new `public` table has a `GRANT` statement.
- RLS is enabled with policies.
- No breaking changes for existing data.

### Step 3 — Publish via Lovable

1. Click the **Publish** button in the top-right corner of the editor.
2. Wait for the build and deploy to finish.
3. Your app will be live at a `.lovable.app` subdomain.

**What deploys automatically:**
- Database migrations
- Edge functions (server routes)
- Server function RPC handlers

**What requires clicking "Update":**
- Frontend UI changes (client-side code, components, styles)

### Step 4 — Configure Environment Secrets

If your server functions need new secrets (third-party API keys, webhook signing secrets), add them in **Project Settings → Secrets** (or via the Cloud panel). They are injected as `process.env.VAR_NAME` at runtime.

### Step 5 — Configure External Webhooks / Cron

For `/api/public/*` endpoints (e.g. Stripe webhooks, scheduled publishing), use the stable production URL:

```
https://project--{project-id}.lovable.app/api/public/publish-scheduled
```

This URL is immutable and will not change if you rename the project.

---

## Security Checklist Before Deploying

- [ ] No `process.env` reads at module scope in shared files.
- [ ] All `*.server.ts` files are only imported by server functions or route handlers.
- [ ] Public API endpoints verify signatures / validate input before acting.
- [ ] Database tables have `GRANT` statements and RLS policies.
- [ ] Service role keys (`SUPABASE_SERVICE_ROLE_KEY`) are never exposed to the client.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ReferenceError: helper is not defined` | Sibling helper in `.functions.ts` | Move helper to a `.server.ts` file and import it. |
| `Unauthorized` during SSR / build | `requireSupabaseAuth` in a public route loader | Call the server function from the component with `useServerFn`, not from the loader. |
| `__dirname is not defined` | Node-only package in Worker | Replace with a Worker-compatible library or call an external API. |
| Blank page after navigation | Parent layout missing `<Outlet />` | Ensure layout routes render `<Outlet />`. |
| 404 on refresh | Missing route file or path mismatch | Check `createFileRoute("...")` matches the filename exactly. |

---

## Runtime Constraints

The deployed Worker runs on **Cloudflare's edge runtime** (workerd), not Node.js. With `nodejs_compat` enabled, many Node.js built-ins work, but avoid packages that:

- Spawn child processes (`child_process`)
- Require native binaries (`sharp`, `canvas`, `puppeteer`)
- Use filesystem watching (`fs.watch`)
- Access `os.cpus()` or `os.networkInterfaces()`

Prefer pure-JavaScript libraries, Web-standard APIs (`fetch`, `crypto`, `streams`), or WASM builds.
