import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type AiAction = "draft" | "improve" | "summarize" | "seo" | "title" | "tags";

const inputSchema = z.object({
  action: z.enum(["draft", "improve", "summarize", "seo", "title", "tags"]),
  topic: z.string().max(500).optional(),
  content: z.string().max(20000).optional(),
});

function systemFor(action: AiAction): string {
  switch (action) {
    case "draft":
      return "You are an editorial writer. Given a topic, write a well-structured ~600 word article in clean HTML using <h2>, <p>, <ul>, <blockquote>. Return ONLY the HTML, no preamble.";
    case "improve":
      return "You are a senior editor. Improve clarity, flow, and tone of the provided HTML article while preserving meaning and structure. Return ONLY the improved HTML.";
    case "summarize":
      return "You are an editor. Write a 1-2 sentence excerpt (max 220 chars) summarizing the article. Return plain text only, no quotes.";
    case "seo":
      return 'You are an SEO specialist. Given an article, return a JSON object {"seo_title": "...", "seo_description": "..."} where seo_title <= 60 chars and seo_description <= 155 chars. Return ONLY the JSON.';
    case "title":
      return "You are an editor. Suggest a single compelling, concise title (max 70 chars) for the article. Return plain text only, no quotes.";
    case "tags":
      return 'You are an editor. Suggest 3-6 short topical tags. Return ONLY a JSON array of lowercase strings, e.g. ["tag-one","tag-two"].';
  }
}

export const aiAssist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI not configured");

    const userMsg =
      data.action === "draft"
        ? `Topic: ${data.topic ?? ""}`
        : `Article content:\n\n${data.content ?? ""}`;

    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemFor(data.action) },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (res.status === 429) return { error: "Rate limited. Try again in a moment." as const, result: null };
    if (res.status === 402) return { error: "AI credits exhausted. Add credits in workspace settings." as const, result: null };
    if (!res.ok) {
      const t = await res.text();
      console.error("AI gateway error", res.status, t);
      return { error: "AI request failed" as const, result: null };
    }
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "";
    return { error: null, result: text };
  });
