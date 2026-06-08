import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("workspace_members")
      .select("role, workspace:workspaces(id,name,slug,logo_url,owner_id,created_at)")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return {
      workspaces: (data ?? [])
        .filter((r: any) => r.workspace)
        .map((r: any) => ({ ...r.workspace, role: r.role })),
    };
  });

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string }) =>
    z.object({ name: z.string().trim().min(2).max(60) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const slug =
      data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) +
      "-" + Math.random().toString(36).slice(2, 8);
    const { data: ws, error } = await supabase
      .from("workspaces")
      .insert({ name: data.name, slug, owner_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const { error: mErr } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: ws.id, user_id: userId, role: "owner" });
    if (mErr) throw new Error(mErr.message);
    return { workspace: ws };
  });

export const updateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name?: string; logo_url?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(2).max(60).optional(),
      logo_url: z.string().url().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...patch } = data;
    const { error } = await supabase.from("workspaces").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspace_id: string }) =>
    z.object({ workspace_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: members, error } = await supabase
      .from("workspace_members")
      .select("id, role, user_id, created_at, profile:profiles(display_name, avatar_url)")
      .eq("workspace_id", data.workspace_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    const { data: invites } = await supabase
      .from("workspace_invitations")
      .select("id, email, role, token, expires_at, accepted_at, created_at")
      .eq("workspace_id", data.workspace_id)
      .is("accepted_at", null);
    return { members: members ?? [], invitations: invites ?? [] };
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspace_id: string; email: string; role: string }) =>
    z.object({
      workspace_id: z.string().uuid(),
      email: z.string().trim().toLowerCase().email().max(255),
      role: z.enum(["admin", "editor", "author", "viewer"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inv, error } = await supabase
      .from("workspace_invitations")
      .insert({
        workspace_id: data.workspace_id,
        email: data.email,
        role: data.role as any,
        invited_by: userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { invitation: inv };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("workspace_invitations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; role: string }) =>
    z.object({
      id: z.string().uuid(),
      role: z.enum(["admin", "editor", "author", "viewer"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workspace_members")
      .update({ role: data.role as any })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("workspace_members").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInvitationByToken = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().min(8).max(128) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Use admin to bypass RLS for token lookup
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("workspace_invitations")
      .select("id, workspace_id, email, role, expires_at, accepted_at, workspace:workspaces(name,slug)")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) return { invitation: null as any };
    return { invitation: inv };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().min(8).max(128) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin
      .from("workspace_invitations")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (!inv) throw new Error("Invitation not found");
    if (inv.accepted_at) throw new Error("Invitation already used");
    if (new Date(inv.expires_at) < new Date()) throw new Error("Invitation expired");

    const { error: mErr } = await supabaseAdmin
      .from("workspace_members")
      .upsert(
        { workspace_id: inv.workspace_id, user_id: userId, role: inv.role },
        { onConflict: "workspace_id,user_id" },
      );
    if (mErr) throw new Error(mErr.message);
    await supabaseAdmin
      .from("workspace_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", inv.id);
    return { workspace_id: inv.workspace_id };
  });
