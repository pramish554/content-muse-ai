import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isEditor(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r: any) => r.role === "admin" || r.role === "editor");
}

/** Schedule article publish (or clear schedule with null). */
export const scheduleArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      articleId: z.string().uuid(),
      scheduledAt: z.string().datetime().nullable(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("articles")
      .update({ scheduled_at: data.scheduledAt })
      .eq("id", data.articleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Author submits article for editorial review. */
export const submitForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ articleId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("articles")
      .update({ review_state: "submitted" })
      .eq("id", data.articleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Editor sets review verdict. */
export const setReviewState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      articleId: z.string().uuid(),
      state: z.enum(["none", "submitted", "approved", "changes_requested"]),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (!(await isEditor(context.supabase, context.userId))) {
      throw new Error("Editor role required");
    }
    const { error } = await context.supabase
      .from("articles")
      .update({ review_state: data.state })
      .eq("id", data.articleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listReviewQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isEditor(context.supabase, context.userId))) return [];
    const { data, error } = await context.supabase
      .from("articles")
      .select("id,title,slug,author_id,review_state,updated_at")
      .in("review_state", ["submitted", "changes_requested"])
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Comments */
export const listComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ articleId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("comments")
      .select("id,body,author_id,created_at")
      .eq("article_id", data.articleId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      articleId: z.string().uuid(),
      body: z.string().min(1).max(2000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("comments")
      .insert({ article_id: data.articleId, author_id: context.userId, body: data.body });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("comments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
