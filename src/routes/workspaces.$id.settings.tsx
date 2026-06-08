import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listMembers,
  inviteMember,
  revokeInvitation,
  updateMemberRole,
  removeMember,
  updateWorkspace,
} from "@/lib/workspaces.functions";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/workspaces/$id/settings")({
  head: () => ({ meta: [{ title: "Workspace Settings — Ink" }] }),
  component: WorkspaceSettings,
});

const ROLES = ["admin", "editor", "author", "viewer"] as const;

function WorkspaceSettings() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { workspaces, refresh } = useWorkspace();
  const ws = workspaces.find((w) => w.id === id);
  const canManage = ws && ["owner", "admin"].includes(ws.role);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  const membersFn = useServerFn(listMembers);
  const inviteFn = useServerFn(inviteMember);
  const revokeFn = useServerFn(revokeInvitation);
  const updateRoleFn = useServerFn(updateMemberRole);
  const removeFn = useServerFn(removeMember);
  const updateWsFn = useServerFn(updateWorkspace);

  const membersQ = useQuery({
    enabled: !!ws,
    queryKey: ["ws-members", id],
    queryFn: () => membersFn({ data: { workspace_id: id } }),
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("author");
  const [inviting, setInviting] = useState(false);

  const [name, setName] = useState(ws?.name ?? "");
  useEffect(() => { if (ws) setName(ws.name); }, [ws?.id]); // eslint-disable-line

  const invite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const { invitation } = await inviteFn({
        data: { workspace_id: id, email: email.trim(), role },
      });
      const link = `${window.location.origin}/invite/${invitation.token}`;
      navigator.clipboard.writeText(link).catch(() => {});
      toast.success("Invitation created — link copied to clipboard");
      setEmail("");
      membersQ.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setInviting(false);
    }
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    toast.success("Invite link copied");
  };

  const saveGeneral = async () => {
    try {
      await updateWsFn({ data: { id, name } });
      toast.success("Saved");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  if (!ws) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="p-10 text-muted-foreground">Workspace not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-6">
          <h1 className="font-serif text-3xl font-semibold">{ws.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Workspace settings · /{ws.slug}</p>
        </header>

        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="invitations">Invitations</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-4">
            <Card className="space-y-4 p-5">
              <div>
                <label className="text-sm font-medium">Workspace name</label>
                <Input
                  className="mt-1.5"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canManage}
                />
              </div>
              <Button onClick={saveGeneral} disabled={!canManage || name === ws.name}>
                Save
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="members" className="mt-4 space-y-4">
            {canManage && (
              <Card className="p-5">
                <h2 className="text-sm font-semibold">Invite a teammate</h2>
                <div className="mt-3 flex gap-2">
                  <Input
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Select value={role} onValueChange={(v) => setRole(v as any)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={invite} disabled={inviting || !email.trim()}>
                    {inviting ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                    <span className="ml-1.5">Invite</span>
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  An invite link will be copied to your clipboard — share it with the teammate.
                </p>
              </Card>
            )}

            <Card className="divide-y divide-border">
              {membersQ.data?.members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {m.profile?.display_name ?? "Member"}
                      {m.user_id === user?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </p>
                  </div>
                  {canManage && m.role !== "owner" && m.user_id !== user?.id ? (
                    <>
                      <Select
                        value={m.role}
                        onValueChange={async (v) => {
                          await updateRoleFn({ data: { id: m.id, role: v } });
                          membersQ.refetch();
                        }}
                      >
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost" size="icon"
                        onClick={async () => {
                          if (!confirm("Remove this member?")) return;
                          await removeFn({ data: { id: m.id } });
                          membersQ.refetch();
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <Badge variant="outline" className="capitalize">{m.role}</Badge>
                  )}
                </div>
              ))}
            </Card>
          </TabsContent>

          <TabsContent value="invitations" className="mt-4">
            <Card className="divide-y divide-border">
              {membersQ.data?.invitations.length === 0 && (
                <p className="p-5 text-sm text-muted-foreground">No pending invitations.</p>
              )}
              {membersQ.data?.invitations.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Role: <span className="capitalize">{inv.role}</span> · expires{" "}
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => copyLink(inv.token)}>
                    <Copy className="mr-1.5 size-3.5" /> Copy link
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost" size="icon"
                      onClick={async () => {
                        await revokeFn({ data: { id: inv.id } });
                        membersQ.refetch();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
