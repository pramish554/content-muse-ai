import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Ink" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, roles, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const { data: articles, refetch } = useQuery({
    enabled: !!user,
    queryKey: ["my-articles", user?.id],
    queryFn: async () => {
      const isEditor = roles.includes("admin") || roles.includes("editor");
      const q = supabase.from("articles").select("*").order("updated_at", { ascending: false });
      if (!isEditor) q.eq("author_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const createDraft = async () => {
    if (!user) return;
    const slug = `draft-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase
      .from("articles")
      .insert({ author_id: user.id, title: "Untitled", slug, content: "" })
      .select()
      .single();
    if (error) return toast.error(error.message);
    navigate({ to: "/editor/$id", params: { id: data.id } });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this article?")) return;
    const { error } = await supabase.from("articles").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); refetch(); }
  };

  if (loading || !user) {
    return <div className="min-h-screen bg-background"><SiteHeader /></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold">Your articles</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {roles.length ? <>Role: {roles.join(", ")}</> : "Role: author"}
            </p>
          </div>
          <Button onClick={createDraft}><Plus className="mr-1.5 size-4" /> New article</Button>
        </div>

        <div className="mt-8 divide-y divide-border rounded-lg border border-border">
          {!articles?.length ? (
            <div className="p-10 text-center text-muted-foreground">
              <FileText className="mx-auto mb-3 size-8 opacity-50" />
              No articles yet. Create your first draft.
            </div>
          ) : articles.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to="/editor/$id" params={{ id: a.id }} className="font-serif text-lg font-medium hover:text-primary">
                    {a.title || "Untitled"}
                  </Link>
                  <Badge variant={a.status === "published" ? "default" : "secondary"}>{a.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Updated {formatDistanceToNow(new Date(a.updated_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex gap-2">
                {a.status === "published" && (
                  <Link to="/articles/$slug" params={{ slug: a.slug }}>
                    <Button variant="ghost" size="sm">View</Button>
                  </Link>
                )}
                <Link to="/editor/$id" params={{ id: a.id }}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={() => remove(a.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
