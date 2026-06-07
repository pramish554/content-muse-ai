import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIModel, aiErrorMessage, logAiUsage } from "@/lib/ai-core.server";

const EMBED_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dims

async function embed(texts: string[]): Promise<number[][]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI not configured");
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS");
  if (!res.ok) {
    const t = await res.text();
    console.error("Embed error", res.status, t);
    throw new Error("Embedding failed");
  }
  const json = await res.json();
  return (json.data ?? []).map((d: any) => d.embedding as number[]);
}

function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(i + size, clean.length);
    chunks.push(clean.slice(i, end));
    if (end === clean.length) break;
    i = end - overlap;
  }
  return chunks;
}

async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 LovableBot" } });
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);
  const html = await res.text();
  // crude text extraction
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const ingestSchema = z.object({
  title: z.string().min(1).max(300),
  source_type: z.enum(["text", "url"]),
  source_url: z.string().url().optional().nullable(),
  content: z.string().min(1).max(500_000).optional(),
});

export const ingestKbSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ingestSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      let text = data.content ?? "";
      if (data.source_type === "url") {
        if (!data.source_url) throw new Error("source_url required");
        text = await fetchUrlText(data.source_url);
      }
      const chunks = chunkText(text);
      if (chunks.length === 0) throw new Error("No content to index");

      const { data: source, error: sErr } = await supabase
        .from("kb_sources")
        .insert({
          user_id: userId,
          title: data.title,
          source_type: data.source_type,
          source_url: data.source_url ?? null,
          char_count: text.length,
          chunk_count: chunks.length,
        })
        .select()
        .single();
      if (sErr) throw new Error(sErr.message);

      // embed in batches of 50
      const BATCH = 50;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const slice = chunks.slice(i, i + BATCH);
        const vectors = await embed(slice);
        const rows = slice.map((content, j) => ({
          source_id: source.id,
          chunk_index: i + j,
          content,
          embedding: vectors[j] as any,
        }));
        const { error: cErr } = await supabase.from("kb_chunks").insert(rows);
        if (cErr) throw new Error(cErr.message);
      }
      await logAiUsage(supabase, userId, "kb_ingest", EMBED_MODEL);
      return { error: null as null | string, source };
    } catch (e: any) {
      return { error: aiErrorMessage(e), source: null };
    }
  });

export const listKbSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("kb_sources")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { sources: data ?? [] };
  });

export const deleteKbSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("kb_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const chatSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});

export interface KbCitation {
  source_id: string;
  source_title: string;
  source_url: string | null;
  chunk_index: number;
  similarity: number;
  snippet: string;
}

export const kbChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => chatSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      const [qVec] = await embed([data.question]);
      const { data: matches, error } = await supabase.rpc("match_kb_chunks", {
        query_embedding: qVec as any,
        match_count: 6,
      });
      if (error) throw new Error(error.message);

      const ctx = (matches ?? [])
        .map((m: any, i: number) => `[${i + 1}] ${m.source_title}\n${m.content}`)
        .join("\n\n---\n\n");

      const system =
        "You are a helpful knowledge-base assistant. Answer the user's question using ONLY the provided sources. Cite sources inline using [1], [2] etc. matching the numbered sources. If the answer is not in the sources, say you don't know. Be concise.";
      const history = (data.history ?? [])
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
      const user = `${history ? history + "\n\n" : ""}Sources:\n${ctx || "(no sources found)"}\n\nQuestion: ${data.question}`;

      const answer = await callAIModel({ system, user });
      await logAiUsage(supabase, userId, "kb_chat");

      const citations: KbCitation[] = (matches ?? []).map((m: any) => ({
        source_id: m.source_id,
        source_title: m.source_title,
        source_url: m.source_url,
        chunk_index: m.chunk_index,
        similarity: Number(m.similarity ?? 0),
        snippet: String(m.content ?? "").slice(0, 280),
      }));

      return { error: null as null | string, answer, citations };
    } catch (e: any) {
      return { error: aiErrorMessage(e), answer: null, citations: [] as KbCitation[] };
    }
  });
