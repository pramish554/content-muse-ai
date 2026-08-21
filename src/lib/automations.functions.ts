import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertWorkspaceMember } from "@/lib/agent-team.server";
import { executeAutomation } from "@/lib/automations.server";

const actionSchema = z.object({
  type: z.enum(["run_agent", "tag_subscriber", "note"]),
  agent: z.enum(["strategist", "researcher", "seo_expert", "writer", "editor", "social"]).optional(),
  prompt: z.string().max(2000).optional(),
  tag: z.string().max(60).optional(),
  text: z.string().max(500).optional(),
});

export const listAutomations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspace_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const [{ data: automations, error }, { data: runs }] = await Promise.all([
      supabase
        .from("automations")
        .select("id,name,trigger,actions,enabled,created_at,updated_at")
        .eq("workspace_id", data.workspace_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("automation_runs")
        .select("id,automation_id,status,log,trigger_payload,created_at")
        .eq("workspace_id", data.workspace_id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (error) throw new Error(error.message);
    return { automations: automations ?? [], runs: runs ?? [] };
  });

export const saveAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        id: z.string().uuid().optional(),
        name: z.string().min(2).max(120),
        trigger: z.enum(["article_published", "subscriber_created", "kb_source_ingested", "manual"]),
        actions: z.array(actionSchema).min(1).max(6),
        enabled: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const row = {
      workspace_id: data.workspace_id,
      name: data.name,
      trigger: data.trigger,
      actions: data.actions,
      enabled: data.enabled,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { error } = await supabase
        .from("automations")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", data.workspace_id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabase.from("automations").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const toggleAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspace_id: z.string().uuid(), id: z.string().uuid(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { error } = await supabase
      .from("automations")
      .update({ enabled: data.enabled })
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspace_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { error } = await supabase
      .from("automations")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runAutomationNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        id: z.string().uuid(),
        payload: z.record(z.string(), z.string()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { data: automation, error } = await supabase
      .from("automations")
      .select("id,workspace_id,name,actions")
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id)
      .single();
    if (error) throw new Error(error.message);
    const res = await executeAutomation(supabase, automation, { ...data.payload, triggered_by: userId });
    return res;
  });
