import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const transcribeSchema = z.object({
  path: z.string().min(1).max(500),
  kind: z.enum(["voice", "podcast", "video"]),
  hint: z.string().max(500).optional(),
});

const articleSchema = z.object({
  transcript: z.string().min(10).max(60000),
  kind: z.enum(["voice", "podcast", "video"]),
  hint: z.string().max(500).optional(),
});

function formatFromMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[mime] ?? mime.split("/")[1] ?? "mp3";
}

async function chat(body: any): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI not configured");
  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS");
  if (!res.ok) {
    const t = await res.text();
    console.error("AI gateway error", res.status, t);
    throw new Error(`AI request failed: ${res.status}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

function aiErrorMessage(e: any): string {
  return e?.message === "RATE_LIMIT"
    ? "Rate limited. Try again in a moment."
    : e?.message === "CREDITS"
      ? "AI credits exhausted. Add credits in workspace settings."
      : e?.message ?? "Request failed";
}

export const transcribeMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => transcribeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (!data.path.startsWith(`${userId}/`)) {
      return { error: "Forbidden path" as const, transcript: null };
    }

    try {
      const { data: file, error: dlErr } = await supabase.storage.from("media").download(data.path);
      if (dlErr || !file) {
        return { error: dlErr?.message ?? "Download failed", transcript: null };
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > 25 * 1024 * 1024) {
        return { error: "File too large (max 25MB).", transcript: null };
      }

      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(binary);
      const mime = (file as Blob).type || (data.kind === "video" ? "video/mp4" : "audio/mpeg");
      const format = formatFromMime(mime);

      const transcript = await chat({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a transcription assistant. Transcribe the provided media accurately in the original language. Include speaker labels (Speaker 1, Speaker 2, …) when multiple voices are present. Return plain text only — no preamble.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: data.hint ? `Context: ${data.hint}` : "Please transcribe this." },
              { type: "input_audio", input_audio: { data: b64, format } },
            ],
          },
        ],
      });

      if (!transcript) return { error: "Empty transcript", transcript: null };
      return { error: null as null | string, transcript };
    } catch (e: any) {
      return { error: aiErrorMessage(e), transcript: null };
    }
  });

export const transcriptToArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => articleSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const raw = await chat({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              'You are an editorial writer. Turn the supplied transcript into a polished blog article. Return ONLY JSON with this shape: {"title":"<= 70 chars","excerpt":"1-2 sentences, <=220 chars","html":"<h2>…</h2><p>…</p> well structured HTML using <h2>,<p>,<ul>,<blockquote>"}. Preserve key quotes verbatim in <blockquote>. Do not invent facts beyond the transcript.',
          },
          {
            role: "user",
            content: `Source type: ${data.kind}\n${data.hint ? `Context: ${data.hint}\n` : ""}\nTranscript:\n${data.transcript}`,
          },
        ],
      });

      let parsed: { title?: string; excerpt?: string; html?: string } = {};
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      } catch {
        return { error: "Could not parse article output", html: raw, title: null, excerpt: null };
      }

      return {
        error: null as null | string,
        html: parsed.html ?? null,
        title: parsed.title ?? null,
        excerpt: parsed.excerpt ?? null,
      };
    } catch (e: any) {
      return { error: aiErrorMessage(e), html: null, title: null, excerpt: null };
    }
  });
