import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIModel, aiErrorMessage, logAiUsage } from "@/lib/ai-core.server";

export const REPURPOSE_FORMATS = {
  twitter_thread: "X / Twitter thread",
  linkedin_post: "LinkedIn post",
  instagram_caption: "Instagram caption",
  newsletter: "Email newsletter",
  youtube_script: "YouTube script",
  podcast_script: "Podcast script",
  tldr: "TL;DR summary",
  faq: "FAQ section",
} as const;

export type RepurposeFormat = keyof typeof REPURPOSE_FORMATS;

const SYSTEMS: Record<RepurposeFormat, string> = {
  twitter_thread:
    "You repurpose articles into engaging X/Twitter threads. Return 6–10 numbered tweets, each on its own line prefixed `1/`, `2/`, etc. Each tweet ≤ 270 chars. Hook in tweet 1. End with a CTA. Plain text only.",
  linkedin_post:
    "You repurpose articles into LinkedIn posts. ~200–300 words, hook on line 1, short paragraphs, line breaks between ideas, 3–5 relevant hashtags at the end. Plain text only.",
  instagram_caption:
    "You repurpose articles into Instagram captions. ~120 words, scannable, 1 emoji per paragraph max, 5–10 hashtags at the end. Plain text only.",
  newsletter:
    "You repurpose articles into a friendly email newsletter. Return HTML using <h2>, <p>, <ul>, <a>. Start with a one-line subject (`Subject: …`) on its own line, then the body HTML.",
  youtube_script:
    "You repurpose articles into a YouTube video script (~4 minutes). Sections: HOOK, INTRO, BODY (3 segments with B-roll cues in [brackets]), CONCLUSION, CTA. Plain text, ALL CAPS section labels.",
  podcast_script:
    "You repurpose articles into a solo podcast script (~6 minutes). Conversational tone, [pause] cues, segments labelled INTRO, MAIN, OUTRO. Plain text only.",
  tldr: "You write a TL;DR. Return 3–5 bullets, each one short sentence. Plain text only, no preamble.",
  faq: "You convert articles into an FAQ. Return 5–7 Q&A pairs as Markdown: `**Q:** question` then `**A:** answer`. Plain text/markdown only.",
};

const schema = z.object({
  articleId: z.string().uuid(),
  format: z.enum(Object.keys(SYSTEMS) as [RepurposeFormat, ...RepurposeFormat[]]),
});

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const repurposeArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: art, error: artErr } = await supabase
      .from("articles")
      .select("id, title, content, excerpt, workspace_id")
      .eq("id", data.articleId)
      .single();
    if (artErr || !art) return { error: artErr?.message ?? "Article not found", content: null };
    if (!art.workspace_id) return { error: "Article has no workspace", content: null };

    const plain = stripHtml(art.content ?? "").slice(0, 12000);
    if (!plain) return { error: "Article has no content yet", content: null };

    try {
      const out = await callAIModel({
        system: SYSTEMS[data.format],
        user: `Title: ${art.title}\n${art.excerpt ? `Excerpt: ${art.excerpt}\n` : ""}\nArticle:\n${plain}`,
      });
      if (!out) return { error: "Empty response from AI", content: null };

      const { data: row, error: insErr } = await supabase
        .from("repurposed_content")
        .insert({
          workspace_id: art.workspace_id,
          article_id: art.id,
          format: data.format,
          content: out,
          model: "google/gemini-3-flash-preview",
          created_by: userId,
        })
        .select("id, format, content, created_at")
        .single();
      if (insErr) return { error: insErr.message, content: null };

      await logAiUsage(supabase, userId, `repurpose:${data.format}`);
      return { error: null as null | string, content: out, row };
    } catch (e: any) {
      return { error: aiErrorMessage(e), content: null };
    }
  });

const listSchema = z.object({ articleId: z.string().uuid() });

export const listRepurposed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("repurposed_content")
      .select("id, format, content, created_at")
      .eq("article_id", data.articleId)
      .order("created_at", { ascending: false });
    if (error) return { error: error.message, items: [] };
    return { error: null as null | string, items: rows ?? [] };
  });

const delSchema = z.object({ id: z.string().uuid() });

export const deleteRepurposed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => delSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("repurposed_content").delete().eq("id", data.id);
    if (error) return { error: error.message };
    return { error: null as null | string };
  });
