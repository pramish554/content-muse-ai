# Next-version build plan

This is a very large scope (10 feature areas, each non-trivial). To keep quality high and avoid breaking what works, I'll ship it in **5 phases**, each independently usable. After every phase you can review and redirect before I continue.

All work extends the existing TanStack Start + Lovable Cloud architecture. No rewrites. All new tables are workspace-scoped with RLS using the existing `is_workspace_member` / `has_workspace_role` helpers.

---

## Phase 1 — Data foundation (1 migration)

One consolidated migration that adds every new table the later phases need, so we only pay the schema-approval cost once.

New tables (all workspace-scoped, RLS on, GRANTs included):
- `subscribers` (email, name, status, tags[], source, confirmed_at)
- `subscriber_events` (signup/unsubscribe/open events for analytics)
- `repurposed_content` (article_id, format, content, model, created_by)
- `kb_folders` (name, parent_id) + `kb_sources.folder_id`, `kb_sources.tags[]`, `kb_sources.category`
- `kb_source_versions` (snapshot history)
- `automations` (trigger, actions jsonb, enabled)
- `automation_runs` (status, log, trigger_payload)
- `generated_media` (workspace_id, kind, prompt, url, article_id?)
- `audit_logs` (workspace_id, actor_id, action, target, metadata)
- `workspace_plans` (workspace_id, plan, stripe_customer_id, stripe_sub_id, status, current_period_end)
- `usage_counters` (workspace_id, month, ai_articles, chat_messages)
- `agent_runs` (agent_type, input, output, tokens, cost)

Extend existing tables (additive only — no breaking changes):
- `kb_sources`: `folder_id`, `tags`, `category`, `version`
- `articles`: nothing changed (already has SEO/view_count)

## Phase 2 — Content Repurposing + Media Generation
- `src/lib/repurpose.functions.ts` — one server fn `repurposeArticle({article_id, format})` covering all 8 formats with format-specific prompts; stores in `repurposed_content`.
- `src/lib/media-gen.functions.ts` — `generateArticleMedia({article_id, kind, prompt})` using Lovable AI image gen; stores in `generated_media` + workspace `media` bucket.
- UI: "Repurpose" tab on the article editor with format picker + output history; "Generate image" button wired into the editor's featured-image slot.

## Phase 3 — Subscribers + Monetization
- `src/lib/subscribers.functions.ts` — list/create/delete/tag/exportCSV.
- Public embed-friendly route `/api/public/subscribe` (with simple rate guard) for capture forms.
- `src/routes/subscribers.tsx` — list, filters, tag manager, growth chart, CSV export, recent signups.
- `src/components/subscribe-form.tsx` — drop-in capture form.
- **Stripe**: I'll call `payments--recommend_payment_provider` then enable Stripe payments and use `batch_create_product` to create Free/Pro/Team plans. Webhook at `/api/public/webhooks/stripe` updates `workspace_plans`. `src/routes/billing.tsx` with plan picker, current usage, invoices. A `requireQuota()` helper checked inside `aiAssist` + `kbChat` to enforce Free limits.

## Phase 4 — AI Agents Hub + Workflow Automation + Advanced KB
- `src/lib/agents.functions.ts` (extend existing): add `strategist`, `seoExpert`, `editor`, `researcher`, `social` — each a typed server fn using `callAIModel`; runs logged to `agent_runs`.
- `src/routes/agents.tsx` — agent hub with cards, run history, chained "workflow" mode (run agents in sequence, pipe output→input).
- `src/lib/automations.functions.ts` — CRUD + `runAutomation` dispatcher. Triggers fired from existing publish flow, subscriber insert, kb ingest (add `await tryRunAutomations(workspace_id, trigger, payload)` calls — non-fatal).
- `src/routes/automations.tsx` — visual builder (trigger select → action list), runs log.
- KB upgrades: extend `knowledge.tsx` with folder tree, tag/category filters, bulk file upload, "re-index" button (re-embed chunks), version history viewer.

## Phase 5 — Analytics Center + Admin expansion + Audit/Security
- `src/lib/analytics.functions.ts` (extend): add subscriber growth, chatbot usage, top KB sources, AI token usage by day/agent.
- `src/routes/analytics.tsx` — full charts dashboard with date-range + CSV export (recharts is already in the stack).
- Admin: extend `admin.tsx` with revenue (from `workspace_plans`), subscription metrics, most-active workspaces, token usage. Pagination + search on every table.
- `src/lib/audit.server.ts` — `logAudit(supabase, {action, target, metadata})` helper. Wire into mutating server fns (article publish, member invite/remove, role change, kb delete, billing change).
- `src/routes/audit.tsx` — workspace audit log viewer (admins only).
- Workspace isolation check helper `assertWorkspaceMember(supabase, userId, workspace_id)` added to any server fn that takes a `workspace_id` parameter.

## Technical notes

- **No new auth provider, no new vector DB** — existing pgvector + `match_kb_chunks` is reused; KB upgrades are metadata-only on top.
- **Rate limiting**: per-IP/email in-DB counter for `/api/public/subscribe`; not a general primitive (per project guidance).
- **Stripe**: seamless built-in integration via `payments--enable_stripe_payments`. Requires the workspace owner to provide email/business name when prompted. Test mode works immediately.
- **Quotas**: monthly counters in `usage_counters`, incremented inside AI server fns; Free plan blocks at limit with a clear upgrade message.
- **Backwards-compat**: every change is additive. Existing routes, server fns, tables, and components are untouched except where explicitly extended.

## What I'd like to confirm before starting

1. **Stripe enablement now or later?** Phase 3 needs me to run `payments--enable_stripe_payments`, which will prompt **you** for business info in a form. If you'd rather defer Stripe, I can ship subscribers in Phase 3 and split monetization into its own phase.
2. **Phase order OK?** Default order is 1→5. Say if you want me to prioritize a different phase first (e.g. "Agents + Automation before Subscribers").
3. **Scope trims?** If any of these are lower priority, say so and I'll drop them: podcast/video scripts, audit log UI, automation visual builder (vs. JSON form), agent chaining UI.

Approve as-is and I'll start Phase 1 (the consolidated migration).