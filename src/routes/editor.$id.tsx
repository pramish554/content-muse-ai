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
import { runAgentTeam, type AgentStep } from "@/lib/agents.functions";
import { mediaToArticle } from "@/lib/media.functions";
import { Sparkles, Wand2, Tags, Search, Eye, Save, Send, Users, CheckCircle2, Loader2, Mic, Upload } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/editor/$id")({
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
  const callTeam = useServerFn(runAgentTeam);
  const callMedia = useServerFn(mediaToArticle);

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
  const [teamAudience, setTeamAudience] = useState("");
  const [teamSteps, setTeamSteps] = useState<AgentStep[]>([]);
  const [teamRunning, setTeamRunning] = useState(false);
  const [mediaKind, setMediaKind] = useState<"voice" | "podcast" | "video">("voice");
  const [mediaHint, setMediaHint] = useState("");
  const [mediaBusy, setMediaBusy] = useState<null | "uploading" | "transcribing">(null);
  const [mediaTranscript, setMediaTranscript] = useState<string | null>(null);

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

  const runTeam = async () => {
    if (!aiTopic) return toast.error("Add a topic first");
    setTeamRunning(true);
    setTeamSteps([]);
    try {
      const res = await callTeam({ data: { topic: aiTopic, audience: teamAudience || undefined } });
      setTeamSteps(res.steps);
      if (res.error) return toast.error(res.error);
      if (res.final_html) setContent(res.final_html);
      if (res.suggested_title && !title) setTitle(res.suggested_title);
      if (res.suggested_title) setSeoTitle(res.suggested_title);
      if (res.meta_description) {
        setSeoDesc(res.meta_description);
        if (!excerpt) setExcerpt(res.meta_description);
      }
      toast.success("Agent team finished");
    } finally {
      setTeamRunning(false);
    }
  };

  const onMediaSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (file.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    setMediaBusy("uploading");
    setMediaTranscript(null);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (upErr) throw upErr;
      setMediaBusy("transcribing");
      const res = await callMedia({ data: { path, kind: mediaKind, hint: mediaHint || undefined } });
      if (res.error) {
        if (res.transcript) setMediaTranscript(res.transcript);
        return toast.error(res.error);
      }
      if (res.transcript) setMediaTranscript(res.transcript);
      if (res.html) setContent(res.html);
      if (res.title && !title) setTitle(res.title);
      if (res.excerpt && !excerpt) setExcerpt(res.excerpt);
      toast.success("Article generated from media");
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setMediaBusy(null);
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

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="flex items-center gap-1.5 font-serif text-lg font-semibold">
              <Users className="size-4 text-primary" /> Multi-agent team
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Research → SEO → Writer → Fact-checker → Editor. Replaces the article content with the final draft.
            </p>
            <div className="mt-3 space-y-2">
              <Label className="text-xs">Audience (optional)</Label>
              <Input
                value={teamAudience}
                onChange={(e) => setTeamAudience(e.target.value)}
                placeholder="e.g. product managers, indie devs"
              />
              <Button size="sm" className="w-full" onClick={runTeam} disabled={teamRunning || !aiTopic}>
                {teamRunning ? (
                  <><Loader2 className="mr-1.5 size-3.5 animate-spin" /> Agents working…</>
                ) : (
                  <><Users className="mr-1.5 size-3.5" /> Run agent team</>
                )}
              </Button>
              {!aiTopic && <p className="text-[10px] text-muted-foreground">Set a topic in the AI assistant above.</p>}
            </div>

            {(teamRunning || teamSteps.length > 0) && (
              <ol className="mt-4 space-y-2 text-xs">
                {(["research", "seo", "writer", "factchecker", "editor"] as const).map((name, i) => {
                  const labels = ["Research", "SEO", "Writer", "Fact-checker", "Editor"];
                  const step = teamSteps.find((s) => s.agent === name);
                  const done = !!step;
                  const active = teamRunning && !done && teamSteps.length === i;
                  return (
                    <li key={name} className="flex items-start gap-2">
                      <span className="mt-0.5">
                        {done ? (
                          <CheckCircle2 className="size-3.5 text-primary" />
                        ) : active ? (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <span className="block size-3.5 rounded-full border border-border" />
                        )}
                      </span>
                      <details className="flex-1" open={done && name !== "writer" && name !== "editor"}>
                        <summary className="cursor-pointer select-none font-medium">{labels[i]} Agent</summary>
                        {step && (
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px] leading-relaxed text-muted-foreground">
                            {step.output.slice(0, 1200)}{step.output.length > 1200 ? "…" : ""}
                          </pre>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ol>
            )}
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
