import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron endpoint: publishes any draft articles whose scheduled_at has passed.
 * Wire to pg_cron / external scheduler. No auth required (lives under /api/public/*).
 */
export const Route = createFileRoute("/api/public/publish-scheduled")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("articles")
          .update({ status: "published", published_at: nowIso, scheduled_at: null })
          .lte("scheduled_at", nowIso)
          .eq("status", "draft")
          .select("id,slug");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ published: data?.length ?? 0, items: data ?? [] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => new Response("ok"),
    },
  },
});
