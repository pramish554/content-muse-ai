import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { format } from "date-fns";

export const Route = createFileRoute("/articles/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — Ink` },
      { property: "og:type", content: "article" },
      { property: "og:url", content: `/articles/${params.slug}` },
    ],
    links: [{ rel: "canonical", href: `/articles/${params.slug}` }],
  }),
  component: ArticleView,
});

function ArticleView() {
  const { slug } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["article", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data;
    },
  });

  // Log anonymous view + inject JSON-LD when article loads
  useEffect(() => {
    if (!data) return;
    supabase.rpc("log_article_view", { _slug: slug });

    const ld = data.json_ld ?? {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: data.title,
      description: data.excerpt ?? undefined,
      image: data.cover_image_url ?? undefined,
      datePublished: data.published_at ?? undefined,
      mainEntityOfPage: { "@type": "WebPage", "@id": `/articles/${slug}` },
    };
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "article-jsonld";
    script.text = JSON.stringify(ld);
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [data, slug]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <article className="mx-auto max-w-2xl px-6 py-16">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && <p className="text-destructive">{(error as Error).message}</p>}
        {data && (
          <>
            <Link to="/" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-primary">← Back</Link>
            <h1 className="mt-4 font-serif text-5xl font-semibold leading-tight tracking-tight">{data.title}</h1>
            {data.excerpt && <p className="mt-4 text-lg text-muted-foreground">{data.excerpt}</p>}
            {data.published_at && (
              <p className="mt-6 text-xs uppercase tracking-wider text-muted-foreground">
                Published {format(new Date(data.published_at), "MMMM d, yyyy")}
                {data.view_count ? ` · ${data.view_count.toLocaleString()} views` : ""}
              </p>
            )}
            {data.cover_image_url && (
              <img src={data.cover_image_url} alt="" className="mt-8 aspect-[16/9] w-full rounded-lg object-cover" />
            )}
            <div className="prose-article mt-10" dangerouslySetInnerHTML={{ __html: data.content }} />
          </>
        )}
      </article>
    </div>
  );
}
