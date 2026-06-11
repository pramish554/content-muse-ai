import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertEditor(supabase: any, userId: string, workspaceId: string) {
  const { data, error } = await supabase.rpc("has_workspace_role", {
    _workspace: workspaceId,
    _user: userId,
    _roles: ["owner", "admin", "editor"],
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

async function assertMember(supabase: any, userId: string, workspaceId: string) {
  const { data, error } = await supabase.rpc("is_workspace_member", {
    _workspace: workspaceId,
    _user: userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listSubscribers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      workspace_id: z.string().uuid(),
      search: z.string().max(120).optional(),
      status: z.enum(["active", "unsubscribed", "pending", "all"]).default("all"),
      tag: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.workspace_id);
    let q = supabase
      .from("subscribers")
      .select("id,email,name,status,tags,source,confirmed_at,created_at")
      .eq("workspace_id", data.workspace_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.search) q = q.ilike("email", `%${data.search}%`);
    if (data.tag) q = q.contains("tags", [data.tag]);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const [{ count: total }, { count: active }, { data: recent }] = await Promise.all([
      supabase.from("subscribers").select("id", { count: "exact", head: true }).eq("workspace_id", data.workspace_id),
      supabase.from("subscribers").select("id", { count: "exact", head: true }).eq("workspace_id", data.workspace_id).eq("status", "active"),
      supabase
        .from("subscribers")
        .select("created_at")
        .eq("workspace_id", data.workspace_id)
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
        .order("created_at", { ascending: true }),
    ]);

    // bucket by day
    const byDay: Record<string, number> = {};
    for (const r of recent ?? []) {
      const k = (r.created_at as string).slice(0, 10);
      byDay[k] = (byDay[k] ?? 0) + 1;
    }
    const series = Object.entries(byDay).map(([date, count]) => ({ date, count }));
    return { subscribers: rows ?? [], total: total ?? 0, active: active ?? 0, series };
  });

export const createSubscriber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      workspace_id: z.string().uuid(),
      email: z.string().trim().toLowerCase().email().max(255),
      name: z.string().trim().max(120).optional(),
      tags: z.array(z.string().max(60)).max(20).default([]),
      source: z.string().max(60).default("manual"),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertEditor(supabase, userId, data.workspace_id);
    const { data: row, error } = await supabase
      .from("subscribers")
      .upsert(
        {
          workspace_id: data.workspace_id,
          email: data.email,
          name: data.name ?? null,
          tags: data.tags,
          source: data.source,
          status: "active",
          confirmed_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,email" },
      )
      .select("id,email,name,status,tags,source,created_at")
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("subscriber_events").insert({
      workspace_id: data.workspace_id,
      subscriber_id: row.id,
      event_type: "signup",
      metadata: { source: data.source, by: userId },
    });
    return row;
  });

export const updateSubscriberTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      workspace_id: z.string().uuid(),
      id: z.string().uuid(),
      tags: z.array(z.string().max(60)).max(20),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertEditor(supabase, userId, data.workspace_id);
    const { error } = await supabase
      .from("subscribers")
      .update({ tags: data.tags })
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSubscriberStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      workspace_id: z.string().uuid(),
      id: z.string().uuid(),
      status: z.enum(["active", "unsubscribed", "pending"]),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertEditor(supabase, userId, data.workspace_id);
    const patch: { status: typeof data.status; unsubscribed_at?: string | null } = { status: data.status };
    if (data.status === "unsubscribed") patch.unsubscribed_at = new Date().toISOString();
    else patch.unsubscribed_at = null;
    const { error } = await supabase
      .from("subscribers")
      .update(patch)
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    await supabase.from("subscriber_events").insert({
      workspace_id: data.workspace_id,
      subscriber_id: data.id,
      event_type: data.status === "unsubscribed" ? "unsubscribe" : "status_change",
      metadata: { status: data.status, by: userId },
    });
    return { ok: true };
  });

export const deleteSubscriber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workspace_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertEditor(supabase, userId, data.workspace_id);
    const { error } = await supabase
      .from("subscribers")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const exportSubscribersCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workspace_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.workspace_id);
    const { data: rows, error } = await supabase
      .from("subscribers")
      .select("email,name,status,tags,source,created_at")
      .eq("workspace_id", data.workspace_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const esc = (v: unknown) => {
      const s = v == null ? "" : Array.isArray(v) ? v.join("|") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "email,name,status,tags,source,created_at";
    const body = (rows ?? []).map((r) => [r.email, r.name, r.status, r.tags, r.source, r.created_at].map(esc).join(",")).join("\n");
    return { csv: header + "\n" + body, count: rows?.length ?? 0 };
  });
