import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIModel, aiErrorMessage, logAiUsage } from "@/lib/ai-core.server";

/** Generate a newsletter HTML email from recently published articles. */
export const generateNewsletter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      days: z.number().int().min(1).max(90).default(7),
      tone: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();

    const { data: articles, error } = await supabase
      .from("articles")
      .select("title,slug,excerpt,published_at")
      .eq("status", "published")
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(12);
    if (error) return { error: error.message };
    if (!articles?.length) return { error: `No articles published in the last ${data.days} days` };

    const list = articles
      .map((a, i) => `${i + 1}. ${a.title} — ${a.excerpt ?? ""} (link:/articles/${a.slug})`)
      .join("\n");

    try {
      const html = await callAIModel({
        system:
          "You are a newsletter editor. Build an HTML email digest with: a short intro paragraph, a numbered list of stories (h3 title link, 1-2 sentence summary), and a brief closing. Use <h1>,<h2>,<h3>,<p>,<a>,<ul>,<li> only. No inline CSS, no <html>/<body>. Keep it warm and concise.",
        user: `Tone: ${data.tone ?? "editorial, curious"}\n\nStories:\n${list}`,
      });
      await logAiUsage(supabase, userId, "newsletter");

      const title = `Weekly digest — ${new Date().toLocaleDateString()}`;
      const { data: row, error: insErr } = await supabase
        .from("newsletters")
        .insert({
          author_id: userId,
          title,
          html,
          period_start: since,
          period_end: new Date().toISOString(),
          status: "draft",
        })
        .select("id,title,html,created_at")
        .single();
      if (insErr) return { error: insErr.message };
      return { error: null as string | null, newsletter: row };
    } catch (e) {
      return { error: aiErrorMessage(e) };
    }
  });

export const listNewsletters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("newsletters")
      .select("id,title,status,created_at,period_start,period_end")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getNewsletter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("newsletters")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteNewsletter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("newsletters").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
