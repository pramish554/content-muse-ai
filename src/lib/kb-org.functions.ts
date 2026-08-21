import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertWorkspaceMember } from "@/lib/agent-team.server";

export const listKbFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspace_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { data: folders, error } = await supabase
      .from("kb_folders")
      .select("id,name,parent_id,created_at")
      .eq("workspace_id", data.workspace_id)
      .order("name");
    if (error) throw new Error(error.message);
    return { folders: folders ?? [] };
  });

export const createKbFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        name: z.string().min(1).max(80),
        parent_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    const { data: row, error } = await supabase
      .from("kb_folders")
      .insert({
        workspace_id: data.workspace_id,
        name: data.name,
        parent_id: data.parent_id ?? null,
        created_by: userId,
      })
      .select("id,name,parent_id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteKbFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspace_id: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertWorkspaceMember(supabase, userId, data.workspace_id);
    await supabase.from("kb_sources").update({ folder_id: null }).eq("folder_id", data.id);
    const { error } = await supabase
      .from("kb_folders")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", data.workspace_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateKbSourceMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        folder_id: z.string().uuid().nullable().optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        category: z.string().max(60).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.folder_id !== undefined) patch.folder_id = data.folder_id;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.category !== undefined) patch.category = data.category;
    const { error } = await context.supabase.from("kb_sources").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listKbSourceVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ source_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("kb_source_versions")
      .select("id,version,title,char_count,chunk_count,created_at")
      .eq("source_id", data.source_id)
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return { versions: rows ?? [] };
  });
