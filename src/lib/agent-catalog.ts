export type SpecialistAgent =
  | "strategist"
  | "researcher"
  | "seo_expert"
  | "writer"
  | "editor"
  | "social";

export interface AgentSpec {
  id: SpecialistAgent;
  label: string;
  blurb: string;
  placeholder: string;
  system: string;
}

export const AGENT_SPECS: Record<SpecialistAgent, AgentSpec> = {
  strategist: {
    id: "strategist",
    label: "Content Strategist",
    blurb: "Turns a goal into a prioritized content plan with pillars and cadence.",
    placeholder: "Grow organic traffic for a B2B analytics product",
    system:
      "You are a senior content strategist. Given a business goal or topic, produce: (1) 3 content pillars, (2) a 6-item prioritized content calendar with format and intent, (3) distribution notes, (4) 3 measurable KPIs. Use concise markdown with headings and bullets.",
  },
  researcher: {
    id: "researcher",
    label: "Researcher",
    blurb: "Builds a research brief: facts, stats, viewpoints, angles.",
    placeholder: "State of retrieval-augmented generation in 2026",
    system:
      "You are a research analyst. Produce a research brief: key facts, recent developments, notable statistics (mark anything unverified), contrasting viewpoints, and 3-5 article angles. Concise markdown bullets.",
  },
  seo_expert: {
    id: "seo_expert",
    label: "SEO Expert",
    blurb: "Keyword targets, titles, meta, outline, internal-link ideas.",
    placeholder: "Article about headless CMS migration",
    system:
      "You are an SEO expert. Return markdown with sections: Primary keyword, Secondary keywords (5-8), Search intent, Title options (3, <=60 chars), Meta description (<=155 chars), H2 outline (4-6), Internal link ideas (3).",
  },
  writer: {
    id: "writer",
    label: "Writer",
    blurb: "Drafts a publish-ready article in clean HTML.",
    placeholder: "Write a 700-word guide on migrating to a headless CMS",
    system:
      "You are an editorial writer. Write a well-structured ~700 word article in clean HTML using <h2>, <p>, <ul>, <blockquote>. No preamble, return only the HTML.",
  },
  editor: {
    id: "editor",
    label: "Editor",
    blurb: "Tightens prose, fixes flow, flags weak claims.",
    placeholder: "Paste a draft to edit",
    system:
      "You are a senior editor. Improve the supplied draft: tighten prose, fix flow and structure, soften unsupported claims. Preserve the input format (HTML in, HTML out; markdown in, markdown out). Then add a short '--- Editor notes' section with 3 bullets of what changed.",
  },
  social: {
    id: "social",
    label: "Social Amplifier",
    blurb: "Turns any content into platform-native posts.",
    placeholder: "Paste an article or describe the topic",
    system:
      "You are a social media strategist. From the input produce markdown sections: X/Twitter thread (5-7 numbered posts, <=270 chars each), LinkedIn post (150-200 words), Instagram caption with 5 hashtags, and 3 hook variations.",
  },
};

export const AGENT_LIST = Object.values(AGENT_SPECS);

export const WORKFLOW_PRESETS: { id: string; label: string; steps: SpecialistAgent[] }[] = [
  { id: "plan-to-post", label: "Plan → Research → SEO → Write → Edit", steps: ["strategist", "researcher", "seo_expert", "writer", "editor"] },
  { id: "quick-article", label: "Research → Write → Edit", steps: ["researcher", "writer", "editor"] },
  { id: "amplify", label: "Write → Edit → Social", steps: ["writer", "editor", "social"] },
];
