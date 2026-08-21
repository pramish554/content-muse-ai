import { callAIModel } from "@/lib/ai-core.server";
import { AGENT_SPECS, type SpecialistAgent } from "@/lib/agent-catalog";

export type AgentName = "research" | "seo" | "writer" | "factchecker" | "editor";

export interface AgentStep {
  agent: AgentName;
  label: string;
  output: string;
}

export const SYSTEM: Record<AgentName, { label: string; prompt: string }> = {
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

export async function callModel(system: string, user: string): Promise<string> {
  return callAIModel({ system, user });
}

export async function runTeamPipeline(topic: string, audience?: string) {
  const steps: AgentStep[] = [];
  const ctx = `Topic: ${topic}${audience ? `\nAudience: ${audience}` : ""}`;

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

  let seoParsed: { suggested_title?: string; meta_description?: string } = {};
  try {
    seoParsed = JSON.parse(seo.replace(/```json|```/g, "").trim());
  } catch {
    /* ignore */
  }

  return {
    steps,
    final_html: final,
    suggested_title: seoParsed.suggested_title ?? null,
    meta_description: seoParsed.meta_description ?? null,
  };
}

export async function runSpecialist(agent: SpecialistAgent, input: string, priorContext?: string) {
  const spec = AGENT_SPECS[agent];
  const user = priorContext
    ? `Previous step output:\n${priorContext}\n\nTask input:\n${input}`
    : input;
  return callAIModel({ system: spec.system, user });
}

export async function assertWorkspaceMember(supabase: any, userId: string, workspaceId: string) {
  const { data, error } = await supabase.rpc("is_workspace_member", {
    _workspace: workspaceId,
    _user: userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}
