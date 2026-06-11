import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  listSubscribers,
  createSubscriber,
  deleteSubscriber,
  setSubscriberStatus,
  updateSubscriberTags,
  exportSubscribersCsv,
} from "@/lib/subscribers.functions";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Download, Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/subscribers")({
  head: () => ({ meta: [{ title: "Subscribers — Ink" }, { name: "description", content: "Audience and email list management" }] }),
  component: SubscribersPage,
});

function SubscribersPage() {
  const { user, loading: authLoading } = useAuth();
  const { active, can } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth", replace: true });
  }, [user, authLoading, navigate]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "unsubscribed" | "pending" | "all">("all");
  const [tag, setTag] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const listFn = useServerFn(listSubscribers);
  const createFn = useServerFn(createSubscriber);
  const deleteFn = useServerFn(deleteSubscriber);
  const statusFn = useServerFn(setSubscriberStatus);
  const tagsFn = useServerFn(updateSubscriberTags);
  const csvFn = useServerFn(exportSubscribersCsv);

  const key = ["subscribers", active?.id, search, status, tag];
  const { data, isLoading } = useQuery({
    enabled: !!active,
    queryKey: key,
    queryFn: () =>
      listFn({
        data: {
          workspace_id: active!.id,
          search: search || undefined,
          status,
          tag: tag || undefined,
          limit: 200,
        },
      }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["subscribers", active?.id] });

  const create = useMutation({
    mutationFn: (v: { email: string; name?: string; tags: string[] }) =>
      createFn({ data: { workspace_id: active!.id, ...v } }),
    onSuccess: () => {
      toast.success("Subscriber added");
      setAddOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { workspace_id: active!.id, id } }),
    onSuccess: () => { toast.success("Removed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStat = useMutation({
    mutationFn: (v: { id: string; status: "active" | "unsubscribed" | "pending" }) =>
      statusFn({ data: { workspace_id: active!.id, ...v } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const setTags = useMutation({
    mutationFn: (v: { id: string; tags: string[] }) =>
      tagsFn({ data: { workspace_id: active!.id, ...v } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadCsv = async () => {
    if (!active) return;
    try {
      const { csv } = await csvFn({ data: { workspace_id: active.id } });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${active.slug}-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const embedSnippet = useMemo(() => {
    if (!active) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `<form onsubmit="event.preventDefault();fetch('${origin}/api/public/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace_id:'${active.id}',email:this.email.value,source:'embed'})}).then(r=>r.json()).then(j=>alert(j.ok?'Subscribed!':j.error))">
  <input name="email" type="email" placeholder="you@example.com" required />
  <button type="submit">Subscribe</button>
</form>`;
  }, [active]);

  if (authLoading || !user) return <div className="min-h-screen bg-background"><SiteHeader /></div>;
  if (!active) return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground">Select a workspace.</div>
    </div>
  );

  const canEdit = can("edit");

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-serif text-3xl font-semibold">Subscribers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Capture, tag, and export your audience for {active.name}.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadCsv}><Download className="mr-1.5 size-4" />Export CSV</Button>
            {canEdit && (
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="mr-1.5 size-4" />Add subscriber</Button>
                </DialogTrigger>
                <AddSubscriberDialog onSubmit={(v) => create.mutate(v)} loading={create.isPending} />
              </Dialog>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total</CardTitle></CardHeader>
            <CardContent className="text-3xl font-serif">{data?.total ?? 0}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Active</CardTitle></CardHeader>
            <CardContent className="text-3xl font-serif">{data?.active ?? 0}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Last 30 days</CardTitle></CardHeader>
            <CardContent className="h-[80px] p-2">
              {data?.series?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.series}>
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="text-xs text-muted-foreground">No signups yet</div>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search email..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[260px]" />
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)} className="max-w-[180px]" />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : !data?.subscribers.length ? (
              <div className="text-sm text-muted-foreground">No subscribers match.</div>
            ) : (
              <div className="divide-y divide-border">
                {data.subscribers.map((s) => (
                  <SubscriberRow
                    key={s.id}
                    sub={s}
                    canEdit={canEdit}
                    onDelete={() => remove.mutate(s.id)}
                    onStatus={(st) => setStat.mutate({ id: s.id, status: st })}
                    onTags={(t) => setTags.mutate({ id: s.id, tags: t })}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Embed signup form</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Drop this snippet on any site to capture subscribers into this workspace.
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{embedSnippet}</pre>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(embedSnippet); toast.success("Copied"); }}>
              <Copy className="mr-1.5 size-4" />Copy snippet
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SubscriberRow({
  sub, canEdit, onDelete, onStatus, onTags,
}: {
  sub: { id: string; email: string; name: string | null; status: string; tags: string[]; source: string | null; created_at: string };
  canEdit: boolean;
  onDelete: () => void;
  onStatus: (s: "active" | "unsubscribed" | "pending") => void;
  onTags: (t: string[]) => void;
}) {
  const [tagInput, setTagInput] = useState("");
  return (
    <div className="flex items-center justify-between gap-3 py-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{sub.email}</span>
          <Badge variant={sub.status === "active" ? "default" : "secondary"}>{sub.status}</Badge>
          {sub.source && <span className="text-xs text-muted-foreground">via {sub.source}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {sub.name && <>{sub.name} · </>}
          joined {formatDistanceToNow(new Date(sub.created_at), { addSuffix: true })}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {sub.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-xs">
              {t}
              {canEdit && (
                <button
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => onTags(sub.tags.filter((x) => x !== t))}
                >×</button>
              )}
            </Badge>
          ))}
          {canEdit && (
            <Input
              placeholder="+ tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagInput.trim()) {
                  e.preventDefault();
                  onTags(Array.from(new Set([...sub.tags, tagInput.trim()])));
                  setTagInput("");
                }
              }}
              className="h-6 w-24 text-xs"
            />
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <Select value={sub.status} onValueChange={(v) => onStatus(v as any)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete ${sub.email}?`)) onDelete(); }}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function AddSubscriberDialog({
  onSubmit, loading,
}: { onSubmit: (v: { email: string; name?: string; tags: string[] }) => void; loading: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Add subscriber</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <DialogFooter>
        <Button
          disabled={!email || loading}
          onClick={() => onSubmit({
            email,
            name: name || undefined,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          })}
        >
          {loading ? "Adding…" : "Add"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
