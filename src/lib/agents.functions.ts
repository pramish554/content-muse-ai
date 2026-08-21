import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiErrorMessage, logAiUsage } from "@/lib/ai-core.server";
import {
  runTeamPipeline,
  runSpecialist,
  assertWorkspaceMember,
  type AgentStep,
} from "@/lib/agent-team.server";

export type { AgentStep } from "@/lib/agent-team.server";
export type { AgentName } from "@/lib/agent-team.server";

export const runAgentTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ topic: z.string().min(3).max(300), audience: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const res = await runTeamPipeline(data.topic, data.audience);
      await logAiUsage(context.supabase, context.userId, "agent_team");
      return { error: null as null | string, ...res };
    } catch (e: any) {
      return {
        error: aiErrorMessage(e),
        steps: [] as AgentStep[],
        final_html: null,
        suggested_title: null,
        meta_description: null,
      };
    }
  });

export const runAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        agent: z.enum(["strategist", "researcher", "seo_expert", "writer", "editor", "social"]),
        input: z.string().min(3).max(20000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    try {
      const output = await runSpecialist(data.agent, data.input);
      await supabase.from("agent_runs").insert({
        workspace_id: data.workspace_id,
        user_id: userId,
        agent_type: data.agent,
        status: "success",
        input: { input: data.input },
        output: { output },
      });
      await logAiUsage(supabase, userId, `agent_${data.agent}`);
      return { error: null as null | string, output };
    } catch (e: any) {
      const error = aiErrorMessage(e);
      await supabase.from("agent_runs").insert({
        workspace_id: data.workspace_id,
        user_id: userId,
        agent_type: data.agent,
        status: "error",
        input: { input: data.input },
        output: { error },
      });
      return { error, output: null as string | null };
    }
  });

export const runAgentWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        input: z.string().min(3).max(20000),
        steps: z
          .array(z.enum(["strategist", "researcher", "seo_expert", "writer", "editor", "social"]))
          .min(1)
          .max(6),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const results: { agent: string; output: string }[] = [];
    let carry: string | undefined;
    try {
      for (const agent of data.steps) {
        const out = await runSpecialist(agent, data.input, carry);
        results.push({ agent, output: out });
        carry = out;
      }
      await supabase.from("agent_runs").insert({
        workspace_id: data.workspace_id,
        user_id: userId,
        agent_type: `workflow:${data.steps.join(">")}`,
        status: "success",
        input: { input: data.input, steps: data.steps },
        output: { results },
      });
      await logAiUsage(supabase, userId, "agent_workflow");
      return { error: null as null | string, results };
    } catch (e: any) {
      const error = aiErrorMessage(e);
      await supabase.from("agent_runs").insert({
        workspace_id: data.workspace_id,
        user_id: userId,
        agent_type: `workflow:${data.steps.join(">")}`,
        status: "error",
        input: { input: data.input, steps: data.steps },
        output: { results, error },
      });
      return { error, results };
    }
  });

export const listAgentRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ workspace_id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(25) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { data: rows, error } = await supabase
      .from("agent_runs")
      .select("id,agent_type,status,input,output,created_at")
      .eq("workspace_id", data.workspace_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { runs: rows ?? [] };
  });

export const deleteAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspace_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { error } = await supabase
      .from("agent_runs")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
