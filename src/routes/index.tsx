import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { formatDistanceToNow } from "date-fns";
import { Sparkles, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ink — AI-powered editorial CMS" },
      { name: "description", content: "An editorial CMS with an AI writing partner. Draft, refine, and publish faster." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { data: articles } = useQuery({
    queryKey: ["published-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, slug, excerpt, cover_image_url, published_at, author_id, profiles:profiles!articles_author_id_fkey(display_name)")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(20);
      if (error) {
        // fallback without join in case relation name differs
        const r = await supabase.from("articles").select("*").eq("status", "published").order("published_at", { ascending: false }).limit(20);
        return r.data ?? [];
      }
      return data ?? [];
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-accent/30 px-3 py-1 text-xs text-accent-foreground">
            <Sparkles className="size-3" /> AI-powered editorial workspace
          </div>
          <h1 className="mt-6 max-w-3xl font-serif text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Write with intention. <span className="text-primary italic">Publish with confidence.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Ink pairs a calm, focused editor with an AI writing partner that drafts, refines, and tightens — so your best ideas reach readers faster.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to="/auth" className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
              Start writing <ArrowRight className="size-4" />
            </Link>
            <a href="#feed" className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-medium">
              Read the feed
            </a>
          </div>
        </div>
      </section>

      <section id="feed" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 flex items-baseline justify-between">
          <h2 className="font-serif text-3xl font-semibold">Latest stories</h2>
          <span className="text-sm text-muted-foreground">{articles?.length ?? 0} published</span>
        </div>
        {!articles?.length ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <p className="text-muted-foreground">No published articles yet. Sign in and write the first one.</p>
          </div>
        ) : (
          <div className="grid gap-10 md:grid-cols-2">
            {articles.map((a: any) => (
              <Link key={a.id} to="/articles/$slug" params={{ slug: a.slug }} className="group block">
                {a.cover_image_url && (
                  <div className="mb-4 aspect-[16/9] overflow-hidden rounded-lg bg-muted">
                    <img src={a.cover_image_url} alt="" className="size-full object-cover transition group-hover:scale-105" />
                  </div>
                )}
                <h3 className="font-serif text-2xl font-semibold leading-tight group-hover:text-primary">
                  {a.title}
                </h3>
                {a.excerpt && <p className="mt-2 line-clamp-2 text-muted-foreground">{a.excerpt}</p>}
                <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
                  {a.published_at ? formatDistanceToNow(new Date(a.published_at), { addSuffix: true }) : "Draft"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
