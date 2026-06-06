import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIModel, aiErrorMessage, logAiUsage } from "@/lib/ai-core.server";

function parseJson<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as T;
  } catch {
    return null;
  }
}

/** Suggest a primary keyword + secondary keywords from title/content. */
export const seoKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().max(300).optional(),
      content: z.string().max(20000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    try {
      const out = await callAIModel({
        system:
          'You are an SEO keyword strategist. Return ONLY JSON: {"primary":"...","secondary":["...","...","..."],"long_tail":["...","..."]} based on the supplied article.',
        user: `Title: ${data.title ?? ""}\n\n${data.content.slice(0, 8000)}`,
        json: true,
      });
      await logAiUsage(context.supabase, context.userId, "seo_keywords");
      const parsed = parseJson<{ primary?: string; secondary?: string[]; long_tail?: string[] }>(out);
      return { error: null as string | null, ...(parsed ?? {}) };
    } catch (e) {
      return { error: aiErrorMessage(e) };
    }
  });

/** Generate an SEO-optimized meta description (<=155 chars). */
export const seoMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().min(1).max(300),
      content: z.string().min(20).max(20000),
      keyword: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    try {
      const out = await callAIModel({
        system:
          'You are an SEO copywriter. Return ONLY JSON: {"seo_title":"<=60 chars","meta_description":"<=155 chars"} that naturally includes the focus keyword.',
        user: `Focus keyword: ${data.keyword ?? "(infer)"}\nTitle: ${data.title}\n\n${data.content.slice(0, 6000)}`,
        json: true,
      });
      await logAiUsage(context.supabase, context.userId, "seo_meta");
      const parsed = parseJson<{ seo_title?: string; meta_description?: string }>(out);
      return { error: null as string | null, ...(parsed ?? {}) };
    } catch (e) {
      return { error: aiErrorMessage(e) };
    }
  });

/** Build JSON-LD Article schema for the page. */
export const seoSchema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().min(1).max(300),
      excerpt: z.string().max(1000).optional(),
      slug: z.string().min(1).max(200),
      coverImageUrl: z.string().max(2000).optional().nullable(),
      author: z.string().max(200).optional(),
      publishedAt: z.string().max(40).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const ld = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: data.title,
      description: data.excerpt ?? undefined,
      image: data.coverImageUrl ?? undefined,
      datePublished: data.publishedAt ?? undefined,
      author: { "@type": "Person", name: data.author ?? "Editorial" },
      mainEntityOfPage: { "@type": "WebPage", "@id": `/articles/${data.slug}` },
    };
    // Strip undefined keys for a clean payload.
    const clean = JSON.parse(JSON.stringify(ld));
    return { error: null as string | null, json_ld: clean };
  });
