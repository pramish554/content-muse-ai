import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const inputSchema = z.object({
  path: z.string().min(1).max(500),
  kind: z.enum(["voice", "podcast", "video"]),
  hint: z.string().max(500).optional(),
});

function formatFromMime(mime: string): string {
  // Gemini accepts common audio/video formats
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

export const mediaToArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Enforce ownership: storage path must start with the user's id folder.
    if (!data.path.startsWith(`${userId}/`)) {
      return { error: "Forbidden path" as const, transcript: null, html: null, title: null, excerpt: null };
    }

    try {
      // Download file from private storage
      const { data: file, error: dlErr } = await supabase.storage.from("media").download(data.path);
      if (dlErr || !file) {
        return { error: dlErr?.message ?? "Download failed", transcript: null, html: null, title: null, excerpt: null };
      }

      // Cap at ~25MB to keep payloads sane
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > 25 * 1024 * 1024) {
        return { error: "File too large (max 25MB).", transcript: null, html: null, title: null, excerpt: null };
      }

      // Base64 encode
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const b64 = btoa(binary);
      const mime = (file as Blob).type || (data.kind === "video" ? "video/mp4" : "audio/mpeg");
      const format = formatFromMime(mime);

      // Step 1: transcript
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

      if (!transcript) {
        return { error: "Empty transcript", transcript: null, html: null, title: null, excerpt: null };
      }

      // Step 2: structured article
      const articleRaw = await chat({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              'You are an editorial writer. Turn the supplied transcript into a polished blog article. Return ONLY JSON with this shape: {"title":"<= 70 chars","excerpt":"1-2 sentences, <=220 chars","html":"<h2>…</h2><p>…</p> well structured HTML using <h2>,<p>,<ul>,<blockquote>"}. Preserve key quotes verbatim in <blockquote>. Do not invent facts beyond the transcript.',
          },
          {
            role: "user",
            content: `Source type: ${data.kind}\n${data.hint ? `Context: ${data.hint}\n` : ""}\nTranscript:\n${transcript}`,
          },
        ],
      });

      let parsed: { title?: string; excerpt?: string; html?: string } = {};
      try {
        parsed = JSON.parse(articleRaw.replace(/```json|```/g, "").trim());
      } catch {
        return {
          error: "Could not parse article output",
          transcript,
          html: articleRaw,
          title: null,
          excerpt: null,
        };
      }

      return {
        error: null as null | string,
        transcript,
        html: parsed.html ?? null,
        title: parsed.title ?? null,
        excerpt: parsed.excerpt ?? null,
      };
    } catch (e: any) {
      const msg =
        e?.message === "RATE_LIMIT"
          ? "Rate limited. Try again in a moment."
          : e?.message === "CREDITS"
            ? "AI credits exhausted. Add credits in workspace settings."
            : e?.message ?? "Media conversion failed";
      return { error: msg, transcript: null, html: null, title: null, excerpt: null };
    }
  });
