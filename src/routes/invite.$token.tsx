import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { getInvitationByToken, acceptInvitation } from "@/lib/workspaces.functions";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Join workspace — Ink" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { refresh, setActive } = useWorkspace();
  const getFn = useServerFn(getInvitationByToken);
  const acceptFn = useServerFn(acceptInvitation);
  const [inv, setInv] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      sessionStorage.setItem("ink.pendingInvite", token);
      navigate({ to: "/auth", replace: true });
      return;
    }
    getFn({ data: { token } })
      .then((res) => setInv(res.invitation))
      .catch((e) => setErr(e?.message ?? "Failed to load"));
  }, [loading, user, token, navigate, getFn]);

  const accept = async () => {
    setBusy(true);
    try {
      const { workspace_id } = await acceptFn({ data: { token } });
      await refresh();
      setActive(workspace_id);
      toast.success("You've joined the workspace");
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-16">
        <Card className="p-6">
          {err ? (
            <p className="text-sm text-destructive">{err}</p>
          ) : !inv ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading invitation…
            </div>
          ) : inv.accepted_at ? (
            <p className="text-sm text-muted-foreground">This invitation has already been used.</p>
          ) : (
            <>
              <h1 className="font-serif text-2xl font-semibold">You're invited</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Join <span className="font-medium text-foreground">{inv.workspace?.name}</span> as{" "}
                <span className="capitalize">{inv.role}</span>.
              </p>
              <Button onClick={accept} disabled={busy} className="mt-5 w-full">
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Accept invitation
              </Button>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
