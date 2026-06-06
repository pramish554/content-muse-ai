import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIModel, aiErrorMessage, logAiUsage } from "@/lib/ai-core.server";

export const LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ja: "Japanese",
  zh: "Chinese (Simplified)",
  hi: "Hindi",
  ar: "Arabic",
};

/** Translate an existing article and create a new draft article in target language. */
export const translateArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      articleId: z.string().uuid(),
      targetLang: z.string().min(2).max(8),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const langName = LANGUAGES[data.targetLang] ?? data.targetLang;

    const { data: src, error } = await supabase
      .from("articles")
      .select("id,title,excerpt,content,seo_title,seo_description,cover_image_url,category_id,language,parent_article_id")
      .eq("id", data.articleId)
      .single();
    if (error || !src) return { error: error?.message ?? "Article not found" };

    if (src.language === data.targetLang) return { error: "Article is already in that language" };

    try {
      const out = await callAIModel({
        system: `You are a professional translator. Translate the supplied article into ${langName}. Preserve HTML structure (h2,p,ul,blockquote,strong,em). Return ONLY JSON: {"title":"...","excerpt":"...","content":"<html>","seo_title":"<=60 chars","seo_description":"<=155 chars"}`,
        user: `Title: ${src.title}\nExcerpt: ${src.excerpt ?? ""}\n\nHTML:\n${(src.content ?? "").slice(0, 14000)}`,
        json: true,
      });
      await logAiUsage(supabase, userId, "translate");
      let parsed: any = null;
      try { parsed = JSON.parse(out.replace(/```json|```/g, "").trim()); } catch { /* */ }
      if (!parsed?.title || !parsed?.content) return { error: "Translation failed to parse" };

      const parentId = src.parent_article_id ?? src.id;
      const baseSlug = (parsed.title as string)
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 70) || "translated";
      const slug = `${baseSlug}-${data.targetLang}`;

      const { data: created, error: insErr } = await supabase
        .from("articles")
        .insert({
          author_id: userId,
          title: parsed.title,
          slug,
          excerpt: parsed.excerpt ?? null,
          content: parsed.content,
          seo_title: parsed.seo_title ?? null,
          seo_description: parsed.seo_description ?? null,
          cover_image_url: src.cover_image_url,
          category_id: src.category_id,
          language: data.targetLang,
          parent_article_id: parentId,
          status: "draft",
        })
        .select("id")
        .single();
      if (insErr) return { error: insErr.message };
      return { error: null as string | null, articleId: created.id };
    } catch (e) {
      return { error: aiErrorMessage(e) };
    }
  });
