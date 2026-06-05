import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { RichEditor } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { aiAssist } from "@/lib/ai.functions";
import { Sparkles, Wand2, Tags, Search, Eye, Save, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/articles/$id/edit")({
  head: () => ({ meta: [{ title: "Edit — Ink" }] }),
  component: EditArticle,
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80) || "untitled";
}

function EditArticle() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const callAi = useServerFn(aiAssist);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [aiTopic, setAiTopic] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("articles").select("*").eq("id", id).single();
      if (error) return toast.error(error.message);
      setTitle(data.title);
      setSlug(data.slug);
      setExcerpt(data.excerpt ?? "");
      setContent(data.content ?? "");
      setCoverUrl(data.cover_image_url ?? "");
      setSeoTitle(data.seo_title ?? "");
      setSeoDesc(data.seo_description ?? "");
      setStatus(data.status);
    })();
  }, [id]);

  const save = async (publish = false) => {
    setBusy("save");
    const payload: any = {
      title: title || "Untitled",
      slug: slug || slugify(title),
      excerpt,
      content,
      cover_image_url: coverUrl || null,
      seo_title: seoTitle || null,
      seo_description: seoDesc || null,
    };
    if (publish) {
      payload.status = "published";
      payload.published_at = new Date().toISOString();
    }
    const { error } = await supabase.from("articles").update(payload).eq("id", id);
    setBusy(null);
    if (error) return toast.error(error.message);
    if (publish) setStatus("published");
    toast.success(publish ? "Published" : "Saved");
  };

  const ai = async (action: "draft" | "improve" | "summarize" | "seo" | "title" | "tags") => {
    setBusy(action);
    try {
      const res = await callAi({ data: { action, topic: aiTopic, content } });
      if (res.error) return toast.error(res.error);
      const out = (res.result ?? "").trim();
      if (action === "draft") setContent(out);
      if (action === "improve") setContent(out);
      if (action === "summarize") setExcerpt(out);
      if (action === "title") setTitle(out.replace(/^["']|["']$/g, ""));
      if (action === "seo") {
        try {
          const cleaned = out.replace(/```json|```/g, "").trim();
          const j = JSON.parse(cleaned);
          if (j.seo_title) setSeoTitle(j.seo_title);
          if (j.seo_description) setSeoDesc(j.seo_description);
        } catch { toast.error("Couldn't parse SEO output"); }
      }
      if (action === "tags") {
        try {
          const cleaned = out.replace(/```json|```/g, "").trim();
          const arr = JSON.parse(cleaned);
          if (Array.isArray(arr)) setTagsInput(arr.join(", "));
        } catch { toast.error("Couldn't parse tags"); }
      }
      toast.success("AI done");
    } finally {
      setBusy(null);
    }
  };

  if (loading || !user) return <div className="min-h-screen bg-background"><SiteHeader /></div>;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Badge variant={status === "published" ? "default" : "secondary"}>{status}</Badge>
            <span className="text-xs text-muted-foreground">Autosave manual — click Save</span>
          </div>

          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (status === "draft") setSlug(slugify(e.target.value)); }}
            placeholder="Article title"
            className="!h-auto border-0 bg-transparent px-0 font-serif !text-4xl font-semibold shadow-none focus-visible:ring-0"
          />

          <Textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="A short excerpt (shown in the feed and as SEO description)"
            rows={2}
            className="resize-none border-0 bg-transparent px-0 text-lg text-muted-foreground shadow-none focus-visible:ring-0"
          />

          <RichEditor value={content} onChange={setContent} />

          <div className="flex gap-2">
            <Button onClick={() => save(false)} disabled={busy === "save"} variant="outline">
              <Save className="mr-1.5 size-4" /> Save draft
            </Button>
            <Button onClick={() => save(true)} disabled={busy === "save"}>
              <Send className="mr-1.5 size-4" /> {status === "published" ? "Update published" : "Publish"}
            </Button>
            {status === "published" && (
              <Button variant="ghost" onClick={() => window.open(`/articles/${slug}`, "_blank")}>
                <Eye className="mr-1.5 size-4" /> View
              </Button>
            )}
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="flex items-center gap-1.5 font-serif text-lg font-semibold"><Sparkles className="size-4 text-primary" /> AI assistant</h3>
            <p className="mt-1 text-xs text-muted-foreground">Draft, refine, and optimize.</p>
            <div className="mt-3 space-y-2">
              <Label className="text-xs">Topic (for draft)</Label>
              <Input value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="e.g. The case for slow blogging" />
              <Button size="sm" variant="secondary" className="w-full" onClick={() => ai("draft")} disabled={busy !== null || !aiTopic}>
                <Wand2 className="mr-1.5 size-3.5" /> {busy === "draft" ? "Drafting…" : "Generate draft"}
              </Button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => ai("improve")} disabled={busy !== null || !content}>Improve</Button>
              <Button size="sm" variant="outline" onClick={() => ai("summarize")} disabled={busy !== null || !content}>Excerpt</Button>
              <Button size="sm" variant="outline" onClick={() => ai("title")} disabled={busy !== null || !content}>Title</Button>
              <Button size="sm" variant="outline" onClick={() => ai("seo")} disabled={busy !== null || !content}>
                <Search className="mr-1 size-3.5" /> SEO
              </Button>
              <Button size="sm" variant="outline" className="col-span-2" onClick={() => ai("tags")} disabled={busy !== null || !content}>
                <Tags className="mr-1 size-3.5" /> Suggest tags
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="font-serif text-lg font-semibold">Settings</h3>
            <div>
              <Label className="text-xs">Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">Cover image URL</Label>
              <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label className="text-xs">SEO title</Label>
              <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} />
            </div>
            <div>
              <Label className="text-xs">SEO description</Label>
              <Textarea value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} rows={2} maxLength={160} />
            </div>
            <div>
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="culture, writing, ai" />
              <p className="mt-1 text-[10px] text-muted-foreground">Saved with the article in a future update.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
