import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const isAdmin = (data ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden: admin role required");
}

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [articles, published, drafts, categories, tags, users] = await Promise.all([
      supabaseAdmin.from("articles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("articles").select("id", { count: "exact", head: true }).eq("status", "published"),
      supabaseAdmin.from("articles").select("id", { count: "exact", head: true }).eq("status", "draft"),
      supabaseAdmin.from("categories").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("tags").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
    ]);

    return {
      articles: articles.count ?? 0,
      published: published.count ?? 0,
      drafts: drafts.count ?? 0,
      categories: categories.count ?? 0,
      tags: tags.count ?? 0,
      users: users.count ?? 0,
    };
  });

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, avatar_url, bio, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const byUser = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.role);
      byUser.set(r.user_id, arr);
    }

    const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map<string, string>();
    for (const u of authList?.users ?? []) emailMap.set(u.id, u.email ?? "");

    return (profiles ?? []).map((p) => ({
      ...p,
      email: emailMap.get(p.id) ?? "",
      roles: byUser.get(p.id) ?? [],
    }));
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      targetUserId: z.string().uuid(),
      role: z.enum(["admin", "editor", "author"]),
      enabled: z.boolean(),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.enabled) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.targetUserId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      if (data.targetUserId === userId && data.role === "admin") {
        throw new Error("You cannot remove your own admin role");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.targetUserId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ targetUserId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    if (data.targetUserId === userId) throw new Error("Cannot delete yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.targetUserId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListArticles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("articles")
      .select("id, title, slug, status, author_id, updated_at, published_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setArticleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      articleId: z.string().uuid(),
      status: z.enum(["draft", "published", "archived"]),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.status === "published") patch.published_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("articles").update(patch).eq("id", data.articleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ articleId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("articles").delete().eq("id", data.articleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(80),
      slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
      description: z.string().max(500).optional().nullable(),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("categories").upsert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(60),
      slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
    }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tags").upsert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ws, error } = await supabaseAdmin
      .from("workspaces")
      .select("id, name, slug, owner_id, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (ws ?? []).map((w) => w.id);
    const [{ data: members }, { data: arts }, { data: kb }] = await Promise.all([
      supabaseAdmin.from("workspace_members").select("workspace_id"),
      supabaseAdmin.from("articles").select("workspace_id"),
      supabaseAdmin.from("kb_sources").select("workspace_id"),
    ]);
    const count = (rows: any[] | null, key: string) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
      return m;
    };
    const mMembers = count(members, "workspace_id");
    const mArts = count(arts, "workspace_id");
    const mKb = count(kb, "workspace_id");
    return (ws ?? []).map((w) => ({
      ...w,
      member_count: mMembers.get(w.id) ?? 0,
      article_count: mArts.get(w.id) ?? 0,
      kb_count: mKb.get(w.id) ?? 0,
    }));
  });

export const adminDeleteWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspaces").delete().eq("id", data.workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: logs, error } = await supabaseAdmin
      .from("ai_usage_log")
      .select("id, user_id, action, model, tokens, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((logs ?? []).map((l) => l.user_id)));
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const nameMap = new Map<string, string>();
    for (const p of profiles ?? []) nameMap.set(p.id, p.display_name ?? "");
    const totalTokens = (logs ?? []).reduce((s, l) => s + (l.tokens ?? 0), 0);
    const byModel = new Map<string, number>();
    for (const l of logs ?? []) byModel.set(l.model ?? "unknown", (byModel.get(l.model ?? "unknown") ?? 0) + (l.tokens ?? 0));
    return {
      logs: (logs ?? []).map((l) => ({ ...l, user_name: nameMap.get(l.user_id) ?? l.user_id.slice(0, 8) })),
      totalTokens,
      byModel: Array.from(byModel.entries()).map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens),
    };
  });

export const adminListKbSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("kb_sources")
      .select("id, title, source_type, source_url, char_count, chunk_count, workspace_id, user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const wsIds = Array.from(new Set((data ?? []).map((s) => s.workspace_id).filter(Boolean) as string[]));
    const { data: ws } = await supabaseAdmin.from("workspaces").select("id, name").in("id", wsIds.length ? wsIds : ["00000000-0000-0000-0000-000000000000"]);
    const wsMap = new Map<string, string>();
    for (const w of ws ?? []) wsMap.set(w.id, w.name);
    return (data ?? []).map((s) => ({ ...s, workspace_name: s.workspace_id ? wsMap.get(s.workspace_id) ?? "—" : "—" }));
  });

export const adminDeleteKbSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("kb_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
