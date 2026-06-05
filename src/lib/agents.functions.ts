import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type AgentName = "research" | "seo" | "writer" | "factchecker" | "editor";

export interface AgentStep {
  agent: AgentName;
  label: string;
  output: string;
}

const inputSchema = z.object({
  topic: z.string().min(3).max(300),
  audience: z.string().max(200).optional(),
});

const SYSTEM: Record<AgentName, { label: string; prompt: string }> = {
  research: {
    label: "Research Agent",
    prompt:
      "You are a research analyst. Given a topic, produce a concise research brief with 4-6 bullet points covering: key facts, recent developments, notable stats (mark unverified), differing viewpoints, and 3-5 angle suggestions. Return plain text with short bullets prefixed by '- '.",
  },
  seo: {
    label: "SEO Agent",
    prompt:
      'You are an SEO strategist. Based on the topic + research brief, return ONLY JSON: {"primary_keyword":"...","secondary_keywords":["...","..."],"suggested_title":"<=60 chars","meta_description":"<=155 chars","outline":["H2 Section 1","H2 Section 2","H2 Section 3","H2 Section 4"]}',
  },
  writer: {
    label: "Writer Agent",
    prompt:
      "You are an editorial writer. Using the research brief and SEO plan, write a ~700 word article in clean HTML using <h2>, <p>, <ul>, <blockquote>. Naturally include the primary and secondary keywords. Return ONLY the HTML, no preamble.",
  },
  factchecker: {
    label: "Fact-Checker Agent",
    prompt:
      "You are a fact-checker. Review the draft HTML against the research brief. Identify claims that are unsupported, ambiguous, or likely inaccurate. Return a short plain-text report: 3-8 bullets with the claim quoted and a verdict (Supported / Needs source / Likely inaccurate) and a one-line note.",
  },
  editor: {
    label: "Editor Agent",
    prompt:
      "You are a senior editor. Apply the fact-checker's notes to the draft HTML: soften unsupported claims, tighten prose, improve flow, and ensure section headings match the SEO outline. Preserve HTML structure (<h2>, <p>, <ul>, <blockquote>). Return ONLY the final polished HTML.",
  },
};

async function callModel(system: string, user: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI not configured");
  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS");
  if (!res.ok) {
    const t = await res.text();
    console.error("AI gateway error", res.status, t);
    throw new Error("AI request failed");
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

export const runAgentTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const steps: AgentStep[] = [];
    const ctx = `Topic: ${data.topic}${data.audience ? `\nAudience: ${data.audience}` : ""}`;

    try {
      const research = await callModel(SYSTEM.research.prompt, ctx);
      steps.push({ agent: "research", label: SYSTEM.research.label, output: research });

      const seo = await callModel(SYSTEM.seo.prompt, `${ctx}\n\nResearch brief:\n${research}`);
      steps.push({ agent: "seo", label: SYSTEM.seo.label, output: seo });

      const draft = await callModel(
        SYSTEM.writer.prompt,
        `${ctx}\n\nResearch brief:\n${research}\n\nSEO plan (JSON):\n${seo}`,
      );
      steps.push({ agent: "writer", label: SYSTEM.writer.label, output: draft });

      const check = await callModel(
        SYSTEM.factchecker.prompt,
        `Research brief:\n${research}\n\nDraft HTML:\n${draft}`,
      );
      steps.push({ agent: "factchecker", label: SYSTEM.factchecker.label, output: check });

      const final = await callModel(
        SYSTEM.editor.prompt,
        `SEO plan (JSON):\n${seo}\n\nFact-check report:\n${check}\n\nDraft HTML:\n${draft}`,
      );
      steps.push({ agent: "editor", label: SYSTEM.editor.label, output: final });

      // Parse SEO JSON best-effort
      let seoParsed: { suggested_title?: string; meta_description?: string } = {};
      try {
        const cleaned = seo.replace(/```json|```/g, "").trim();
        seoParsed = JSON.parse(cleaned);
      } catch { /* ignore */ }

      return {
        error: null as null | string,
        steps,
        final_html: final,
        suggested_title: seoParsed.suggested_title ?? null,
        meta_description: seoParsed.meta_description ?? null,
      };
    } catch (e: any) {
      const msg =
        e?.message === "RATE_LIMIT"
          ? "Rate limited. Try again in a moment."
          : e?.message === "CREDITS"
            ? "AI credits exhausted. Add credits in workspace settings."
            : "Agent team failed";
      return { error: msg, steps, final_html: null, suggested_title: null, meta_description: null };
    }
  });
