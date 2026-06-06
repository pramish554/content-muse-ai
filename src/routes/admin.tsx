import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  adminStats,
  listUsers,
  setUserRole,
  deleteUser,
  adminListArticles,
  setArticleStatus,
  deleteArticle,
  upsertCategory,
  deleteCategory,
  upsertTag,
  deleteTag,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { listReviewQueue, setReviewState } from "@/lib/workflow.functions";
import { generateNewsletter, listNewsletters, getNewsletter, deleteNewsletter } from "@/lib/newsletter.functions";
import { platformAnalytics } from "@/lib/analytics.functions";
import { Shield, Trash2, FileText, Users, Tag, FolderTree, BarChart3, Mail, ClipboardCheck, Sparkles, Loader2, Eye } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Ink" }] }),
  component: AdminPage,
});

const ROLES = ["admin", "editor", "author"] as const;
type RoleName = (typeof ROLES)[number];

function AdminPage() {
  const { user, roles, loading } = useAuth();
  const navigate = useNavigate();
  const isAdmin = roles.includes("admin");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return <div className="min-h-screen bg-background"><SiteHeader /></div>;

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <Shield className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-4 font-serif text-2xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account doesn't have the admin role.
          </p>
          <Link to="/dashboard" className="mt-6 inline-block">
            <Button variant="outline">Back to dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-semibold">Admin panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage content, users, taxonomy, and platform settings.
          </p>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="overview"><BarChart3 className="mr-1.5 size-4" /> Overview</TabsTrigger>
            <TabsTrigger value="articles"><FileText className="mr-1.5 size-4" /> Articles</TabsTrigger>
            <TabsTrigger value="review"><ClipboardCheck className="mr-1.5 size-4" /> Review</TabsTrigger>
            <TabsTrigger value="newsletters"><Mail className="mr-1.5 size-4" /> Newsletters</TabsTrigger>
            <TabsTrigger value="analytics"><BarChart3 className="mr-1.5 size-4" /> Analytics</TabsTrigger>
            <TabsTrigger value="users"><Users className="mr-1.5 size-4" /> Users</TabsTrigger>
            <TabsTrigger value="categories"><FolderTree className="mr-1.5 size-4" /> Categories</TabsTrigger>
            <TabsTrigger value="tags"><Tag className="mr-1.5 size-4" /> Tags</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6"><OverviewPanel /></TabsContent>
          <TabsContent value="articles" className="mt-6"><ArticlesPanel /></TabsContent>
          <TabsContent value="review" className="mt-6"><ReviewPanel /></TabsContent>
          <TabsContent value="newsletters" className="mt-6"><NewslettersPanel /></TabsContent>
          <TabsContent value="analytics" className="mt-6"><AnalyticsPanel /></TabsContent>
          <TabsContent value="users" className="mt-6"><UsersPanel currentUserId={user.id} /></TabsContent>
          <TabsContent value="categories" className="mt-6"><CategoriesPanel /></TabsContent>
          <TabsContent value="tags" className="mt-6"><TagsPanel /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function OverviewPanel() {
  const fn = useServerFn(adminStats);
  const { data, isLoading } = useQuery({ queryKey: ["admin-stats"], queryFn: () => fn() });
  const items = [
    { label: "Total articles", value: data?.articles, icon: FileText },
    { label: "Published", value: data?.published, icon: FileText },
    { label: "Drafts", value: data?.drafts, icon: FileText },
    { label: "Users", value: data?.users, icon: Users },
    { label: "Categories", value: data?.categories, icon: FolderTree },
    { label: "Tags", value: data?.tags, icon: Tag },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {items.map((i) => (
        <Card key={i.label}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
              {i.label} <i.icon className="size-4" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-serif text-3xl font-semibold">
              {isLoading ? "—" : (i.value ?? 0)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ArticlesPanel() {
  const listFn = useServerFn(adminListArticles);
  const statusFn = useServerFn(setArticleStatus);
  const delFn = useServerFn(deleteArticle);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-articles"],
    queryFn: () => listFn(),
  });

  const onStatus = async (id: string, status: "draft" | "published" | "archived") => {
    try {
      await statusFn({ data: { articleId: id, status } });
      toast.success(`Marked as ${status}`);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this article permanently?")) return;
    try {
      await delFn({ data: { articleId: id } });
      toast.success("Deleted");
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {!data?.length ? (
        <p className="p-8 text-center text-muted-foreground">No articles yet.</p>
      ) : (
        data.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link to="/editor/$id" params={{ id: a.id }} className="font-serif font-medium hover:text-primary">
                  {a.title || "Untitled"}
                </Link>
                <Badge variant={a.status === "published" ? "default" : "secondary"}>{a.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">/{a.slug}</p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={a.status} onValueChange={(v) => onStatus(a.id, v as any)}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => onDelete(a.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const listFn = useServerFn(listUsers);
  const roleFn = useServerFn(setUserRole);
  const delFn = useServerFn(deleteUser);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn(),
  });

  const toggleRole = async (uid: string, role: RoleName, enabled: boolean) => {
    try {
      await roleFn({ data: { targetUserId: uid, role, enabled } });
      toast.success(`Role ${role} ${enabled ? "granted" : "revoked"}`);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const onDelete = async (uid: string) => {
    if (!confirm("Permanently delete this user and their data?")) return;
    try {
      await delFn({ data: { targetUserId: uid } });
      toast.success("User deleted");
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3">User</th>
            <th className="p-3">Email</th>
            {ROLES.map((r) => <th key={r} className="p-3 capitalize">{r}</th>)}
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {data?.map((u: any) => (
            <tr key={u.id} className="border-t border-border">
              <td className="p-3">
                <div className="font-medium">{u.display_name || "—"}</div>
                <div className="text-xs text-muted-foreground">{u.id.slice(0, 8)}…</div>
              </td>
              <td className="p-3 text-muted-foreground">{u.email}</td>
              {ROLES.map((r) => (
                <td key={r} className="p-3">
                  <Checkbox
                    checked={u.roles.includes(r)}
                    onCheckedChange={(v) => toggleRole(u.id, r, !!v)}
                  />
                </td>
              ))}
              <td className="p-3 text-right">
                {u.id !== currentUserId && (
                  <Button variant="ghost" size="icon" onClick={() => onDelete(u.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoriesPanel() {
  const upsertFn = useServerFn(upsertCategory);
  const delFn = useServerFn(deleteCategory);
  const { data, refetch } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [desc, setDesc] = useState("");

  const add = async () => {
    try {
      await upsertFn({ data: { name, slug, description: desc || null } });
      toast.success("Category saved");
      setName(""); setSlug(""); setDesc("");
      refetch();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete category?")) return;
    try { await delFn({ data: { id } }); toast.success("Deleted"); refetch(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="divide-y divide-border rounded-lg border border-border">
        {!data?.length ? (
          <p className="p-8 text-center text-muted-foreground">No categories yet.</p>
        ) : data.map((c: any) => (
          <div key={c.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">/{c.slug} {c.description ? `· ${c.description}` : ""}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">New category</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Name" value={name} onChange={(e) => {
            setName(e.target.value);
            if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
          }} />
          <Input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Textarea placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button className="w-full" onClick={add} disabled={!name || !slug}>Add category</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function TagsPanel() {
  const upsertFn = useServerFn(upsertTag);
  const delFn = useServerFn(deleteTag);
  const { data, refetch } = useQuery({
    queryKey: ["admin-tags"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tags").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const add = async () => {
    try {
      await upsertFn({ data: { name, slug } });
      toast.success("Tag saved");
      setName(""); setSlug("");
      refetch();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete tag?")) return;
    try { await delFn({ data: { id } }); toast.success("Deleted"); refetch(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border p-4">
        {!data?.length ? (
          <p className="text-muted-foreground">No tags yet.</p>
        ) : data.map((t: any) => (
          <Badge key={t.id} variant="secondary" className="gap-1.5 py-1.5 pr-1">
            {t.name}
            <button onClick={() => remove(t.id)} className="ml-1 rounded p-0.5 hover:bg-background">
              <Trash2 className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">New tag</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Name" value={name} onChange={(e) => {
            setName(e.target.value);
            if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
          }} />
          <Input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <Button className="w-full" onClick={add} disabled={!name || !slug}>Add tag</Button>
        </CardContent>
      </Card>
    </div>
  );
}
