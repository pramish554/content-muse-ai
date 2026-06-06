// Server-only helper for Lovable AI gateway calls.
export const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export async function callAIModel(opts: {
  system: string;
  user: string;
  model?: string;
  json?: boolean;
}): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI not configured");
  const body: any = {
    model: opts.model ?? "google/gemini-3-flash-preview",
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.json) body.response_format = { type: "json_object" };

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
    throw new Error("AI request failed");
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

export function aiErrorMessage(e: any): string {
  if (e?.message === "RATE_LIMIT") return "Rate limited. Try again in a moment.";
  if (e?.message === "CREDITS") return "AI credits exhausted. Add credits in workspace settings.";
  return e?.message ?? "AI request failed";
}

export async function logAiUsage(
  supabase: any,
  userId: string,
  action: string,
  model = "google/gemini-3-flash-preview",
) {
  try {
    await supabase.from("ai_usage_log").insert({ user_id: userId, action, model });
  } catch {
    /* non-fatal */
  }
}
