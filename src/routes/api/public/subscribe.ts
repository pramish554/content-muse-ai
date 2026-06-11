import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  workspace_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().max(120).optional(),
  source: z.string().max(60).optional(),
  tags: z.array(z.string().max(60)).max(10).optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export const Route = createFileRoute("/api/public/subscribe")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400, headers: cors });
        }
        const data = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // rate guard: max 5 inserts per workspace+email per hour
        const since = new Date(Date.now() - 3600_000).toISOString();
        const { count } = await supabaseAdmin
          .from("subscriber_events")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspace_id)
          .gte("created_at", since)
          .contains("metadata", { email: data.email });
        if ((count ?? 0) > 5) {
          return Response.json({ error: "Too many attempts" }, { status: 429, headers: cors });
        }

        const { data: row, error } = await supabaseAdmin
          .from("subscribers")
          .upsert(
            {
              workspace_id: data.workspace_id,
              email: data.email,
              name: data.name ?? null,
              tags: data.tags ?? [],
              source: data.source ?? "public_form",
              status: "active",
              confirmed_at: new Date().toISOString(),
            },
            { onConflict: "workspace_id,email" },
          )
          .select("id")
          .single();
        if (error) {
          return Response.json({ error: error.message }, { status: 500, headers: cors });
        }
        await supabaseAdmin.from("subscriber_events").insert({
          workspace_id: data.workspace_id,
          subscriber_id: row.id,
          event_type: "signup",
          metadata: { source: data.source ?? "public_form", email: data.email },
        });
        return Response.json({ ok: true }, { headers: cors });
      },
    },
  },
});
