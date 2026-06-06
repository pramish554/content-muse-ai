import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const platformAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = isAdmin ? supabaseAdmin : supabase;

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [topArticles, views30, views7, ai30] = await Promise.all([
      db.from("articles")
        .select("id,title,slug,view_count,author_id")
        .order("view_count", { ascending: false })
        .limit(10),
      db.from("article_views").select("id", { count: "exact", head: true }).gte("created_at", since30),
      db.from("article_views").select("id", { count: "exact", head: true }).gte("created_at", since7),
      db.from("ai_usage_log").select("action").gte("created_at", since30),
    ]);

    const aiByAction = new Map<string, number>();
    for (const r of ai30.data ?? []) {
      aiByAction.set(r.action, (aiByAction.get(r.action) ?? 0) + 1);
    }
    const aiBreakdown = Array.from(aiByAction.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    return {
      isAdmin,
      views30d: views30.count ?? 0,
      views7d: views7.count ?? 0,
      ai30d: (ai30.data ?? []).length,
      topArticles: topArticles.data ?? [],
      aiBreakdown,
    };
  });
