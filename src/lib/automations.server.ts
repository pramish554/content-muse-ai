import { runSpecialist } from "@/lib/agent-team.server";
import type { SpecialistAgent } from "@/lib/agent-catalog";

export const AUTOMATION_TRIGGERS = [
  { id: "article_published", label: "Article published" },
  { id: "subscriber_created", label: "New subscriber" },
  { id: "kb_source_ingested", label: "Knowledge source added" },
  { id: "manual", label: "Manual run only" },
] as const;

export const AUTOMATION_ACTIONS = [
  { id: "run_agent", label: "Run an AI agent" },
  { id: "tag_subscriber", label: "Tag the subscriber" },
  { id: "note", label: "Write a log note" },
] as const;

export interface AutomationAction {
  type: "run_agent" | "tag_subscriber" | "note";
  agent?: SpecialistAgent;
  prompt?: string;
  tag?: string;
  text?: string;
}

function interpolate(tpl: string, payload: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(payload[k] ?? ""));
}

export async function executeAutomation(
  supabase: any,
  automation: { id: string; workspace_id: string; name: string; actions: unknown },
  payload: Record<string, unknown>,
) {
  const actions = (Array.isArray(automation.actions) ? automation.actions : []) as AutomationAction[];
  const log: { action: string; status: "ok" | "error"; detail: string }[] = [];
  let status: "success" | "error" | "partial" = "success";

  for (const action of actions) {
    try {
      if (action.type === "run_agent" && action.agent) {
        const input = interpolate(action.prompt || "{{title}} {{email}}", payload).trim() || automation.name;
        const output = await runSpecialist(action.agent, input);
        await supabase.from("agent_runs").insert({
          workspace_id: automation.workspace_id,
          agent_type: action.agent,
          status: "success",
          input: { input, automation_id: automation.id },
          output: { output },
        });
        log.push({ action: `run_agent:${action.agent}`, status: "ok", detail: output.slice(0, 600) });
      } else if (action.type === "tag_subscriber" && action.tag && payload.subscriber_id) {
        const { data: sub } = await supabase
          .from("subscribers")
          .select("tags")
          .eq("id", payload.subscriber_id)
          .maybeSingle();
        const tags = Array.from(new Set([...(sub?.tags ?? []), action.tag]));
        await supabase.from("subscribers").update({ tags }).eq("id", payload.subscriber_id);
        log.push({ action: "tag_subscriber", status: "ok", detail: action.tag });
      } else if (action.type === "note") {
        log.push({ action: "note", status: "ok", detail: interpolate(action.text ?? "", payload) });
      } else {
        log.push({ action: action.type, status: "error", detail: "Action misconfigured or missing payload" });
        status = "partial";
      }
    } catch (e: any) {
      log.push({ action: action.type, status: "error", detail: e?.message ?? "failed" });
      status = "error";
    }
  }

  await supabase.from("automation_runs").insert({
    workspace_id: automation.workspace_id,
    automation_id: automation.id,
    status,
    trigger_payload: payload,
    log,
  });

  return { status, log };
}

/** Fire all enabled automations for a trigger. Never throws. */
export async function tryRunAutomations(
  supabase: any,
  workspaceId: string,
  trigger: string,
  payload: Record<string, unknown>,
) {
  try {
    const { data: rows } = await supabase
      .from("automations")
      .select("id,workspace_id,name,actions")
      .eq("workspace_id", workspaceId)
      .eq("trigger", trigger)
      .eq("enabled", true);
    for (const a of rows ?? []) {
      await executeAutomation(supabase, a, payload);
    }
  } catch (e) {
    console.error("automation dispatch failed", e);
  }
}
