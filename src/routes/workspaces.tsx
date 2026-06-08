import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { createWorkspace } from "@/lib/workspaces.functions";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Settings } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/workspaces")({
  head: () => ({ meta: [{ title: "Workspaces — Ink" }] }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const { user, loading } = useAuth();
  const { workspaces, active, setActive, refresh } = useWorkspace();
  const navigate = useNavigate();
  const createFn = useServerFn(createWorkspace);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { workspace } = await createFn({ data: { name: name.trim() } });
      toast.success("Workspace created");
      setName("");
      await refresh();
      setActive(workspace.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">Workspaces</h1>
        <p className="mt-2 text-muted-foreground">
          Each workspace has its own articles, knowledge base, and team.
        </p>

        <Card className="mt-8 p-5">
          <h2 className="text-sm font-semibold">Create a new workspace</h2>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Acme Publishing"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <Button onClick={create} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              <span className="ml-1.5">Create</span>
            </Button>
          </div>
        </Card>

        <div className="mt-8 space-y-3">
          {workspaces.map((w) => (
            <Card key={w.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-medium">{w.name}</h3>
                  <Badge variant="outline" className="capitalize">{w.role}</Badge>
                  {active?.id === w.id && <Badge>Active</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">/{w.slug}</p>
              </div>
              <div className="flex gap-2">
                {active?.id !== w.id && (
                  <Button variant="outline" size="sm" onClick={() => setActive(w.id)}>
                    Switch
                  </Button>
                )}
                <Link to="/workspaces/$id/settings" params={{ id: w.id }}>
                  <Button variant="ghost" size="sm">
                    <Settings className="size-4" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
