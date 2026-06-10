import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAiUsage } from "@/lib/ai-core.server";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const schema = z.object({
  articleId: z.string().uuid().optional(),
  workspaceId: z.string().uuid(),
  prompt: z.string().min(3).max(800),
  kind: z.enum(["cover", "inline", "social"]).default("cover"),
});

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext =
    mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return { bytes, mime, ext };
}

export const generateArticleImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { error: "AI not configured", url: null };

    try {
      const res = await fetch(LOVABLE_AI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image-preview",
          modalities: ["image", "text"],
          messages: [{ role: "user", content: data.prompt }],
        }),
      });

      if (res.status === 429) return { error: "Rate limited. Try again in a moment.", url: null };
      if (res.status === 402) return { error: "AI credits exhausted.", url: null };
      if (!res.ok) {
        const t = await res.text();
        console.error("Image gen error", res.status, t);
        return { error: "Image generation failed", url: null };
      }

      const json = await res.json();
      const dataUrl: string | undefined = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!dataUrl) return { error: "No image returned by AI", url: null };

      const parsed = dataUrlToBytes(dataUrl);
      if (!parsed) return { error: "Bad image data", url: null };

      const path = `${data.workspaceId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${parsed.ext}`;
      const { error: upErr } = await supabase.storage
        .from("generated-images")
        .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: false });
      if (upErr) return { error: upErr.message, url: null };

      const { data: signed, error: signErr } = await supabase.storage
        .from("generated-images")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed) return { error: signErr?.message ?? "Could not sign URL", url: null };

      const { data: row, error: insErr } = await supabase
        .from("generated_media")
        .insert({
          workspace_id: data.workspaceId,
          article_id: data.articleId ?? null,
          kind: data.kind,
          prompt: data.prompt,
          url: signed.signedUrl,
          model: "google/gemini-2.5-flash-image-preview",
          created_by: userId,
        })
        .select("id, url, kind, prompt, created_at")
        .single();
      if (insErr) return { error: insErr.message, url: null };

      await logAiUsage(supabase, userId, `image:${data.kind}`, "google/gemini-2.5-flash-image-preview");
      return { error: null as null | string, url: signed.signedUrl, path, row };
    } catch (e: any) {
      console.error(e);
      return { error: e?.message ?? "Image generation failed", url: null };
    }
  });

const listSchema = z.object({ articleId: z.string().uuid() });

export const listGeneratedMedia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("generated_media")
      .select("id, url, kind, prompt, created_at")
      .eq("article_id", data.articleId)
      .order("created_at", { ascending: false });
    if (error) return { error: error.message, items: [] };
    return { error: null as null | string, items: rows ?? [] };
  });
