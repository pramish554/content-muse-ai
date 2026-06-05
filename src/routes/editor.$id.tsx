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
import { transcribeMedia, transcriptToArticle } from "@/lib/media.functions";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Wand2, Tags, Search, Eye, Save, Send, Users, CheckCircle2, Loader2, Mic, Upload, RefreshCw, AlertTriangle, FileText, X } from "lucide-react";
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
  const callTranscribe = useServerFn(transcribeMedia);
  const callArticle = useServerFn(transcriptToArticle);

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
  type MediaStage = "idle" | "uploading" | "uploaded" | "transcribing" | "ready" | "generating" | "error";
  const [mediaStage, setMediaStage] = useState<MediaStage>("idle");
  const [mediaProgress, setMediaProgress] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaErrorAt, setMediaErrorAt] = useState<"upload" | "transcribe" | "article" | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [mediaTranscript, setMediaTranscript] = useState<string>("");

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

  const uploadWithProgress = (file: File, signedUrl: string) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl, true);
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setMediaProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload aborted"));
      xhr.send(file);
    });

  const doUpload = async (file: File) => {
    if (!user) return;
    setMediaStage("uploading");
    setMediaProgress(0);
    setMediaError(null);
    setMediaErrorAt(null);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { data: signed, error: signErr } = await supabase.storage
        .from("media")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw new Error(signErr?.message ?? "Could not get upload URL");
      await uploadWithProgress(file, signed.signedUrl);
      setMediaPath(path);
      setMediaStage("uploaded");
      await doTranscribe(path);
    } catch (err: any) {
      setMediaError(err?.message ?? "Upload failed");
      setMediaErrorAt("upload");
      setMediaStage("error");
    }
  };

  const doTranscribe = async (path: string) => {
    setMediaStage("transcribing");
    setMediaError(null);
    setMediaErrorAt(null);
    try {
      const res = await callTranscribe({ data: { path, kind: mediaKind, hint: mediaHint || undefined } });
      if (res.error || !res.transcript) {
        setMediaError(res.error ?? "Empty transcript");
        setMediaErrorAt("transcribe");
        setMediaStage("error");
        return;
      }
      setMediaTranscript(res.transcript);
      setMediaStage("ready");
      toast.success("Transcript ready — review before generating");
    } catch (err: any) {
      setMediaError(err?.message ?? "Transcription failed");
      setMediaErrorAt("transcribe");
      setMediaStage("error");
    }
  };

  const doGenerateArticle = async () => {
    if (!mediaTranscript.trim()) return toast.error("Transcript is empty");
    setMediaStage("generating");
    setMediaError(null);
    setMediaErrorAt(null);
    try {
      const res = await callArticle({
        data: { transcript: mediaTranscript, kind: mediaKind, hint: mediaHint || undefined },
      });
      if (res.error) {
        setMediaError(res.error);
        setMediaErrorAt("article");
        setMediaStage("ready");
        return;
      }
      if (res.html) setContent(res.html);
      if (res.title && !title) setTitle(res.title);
      if (res.excerpt && !excerpt) setExcerpt(res.excerpt);
      setMediaStage("ready");
      toast.success("Article generated from transcript");
    } catch (err: any) {
      setMediaError(err?.message ?? "Generation failed");
      setMediaErrorAt("article");
      setMediaStage("ready");
    }
  };

  const onMediaSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (file.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    setMediaFile(file);
    setMediaTranscript("");
    setMediaPath(null);
    void doUpload(file);
  };

  const retryMedia = () => {
    if (mediaErrorAt === "upload" && mediaFile) return void doUpload(mediaFile);
    if (mediaErrorAt === "transcribe" && mediaPath) return void doTranscribe(mediaPath);
    if (mediaErrorAt === "article") return void doGenerateArticle();
  };

  const resetMedia = () => {
    setMediaFile(null);
    setMediaPath(null);
    setMediaTranscript("");
    setMediaProgress(0);
    setMediaError(null);
    setMediaErrorAt(null);
    setMediaStage("idle");
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
              <Mic className="size-4 text-primary" /> Voice / Podcast / Video → Article
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload audio or video (max 25MB). AI transcribes it and turns it into a structured article.
            </p>
            <div className="mt-3 space-y-3">
              <div className="flex gap-1">
                {(["voice", "podcast", "video"] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={mediaKind === k ? "secondary" : "outline"}
                    className="flex-1 capitalize"
                    onClick={() => setMediaKind(k)}
                    disabled={mediaStage === "uploading" || mediaStage === "transcribing" || mediaStage === "generating"}
                  >
                    {k}
                  </Button>
                ))}
              </div>
              <div>
                <Label className="text-xs">Context (optional)</Label>
                <Input
                  value={mediaHint}
                  onChange={(e) => setMediaHint(e.target.value)}
                  placeholder="e.g. Interview with Jane Doe about climate tech"
                />
              </div>

              {(mediaStage === "idle" || mediaStage === "error") && (
                <label className="block">
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    className="hidden"
                    onChange={onMediaSelected}
                  />
                  <Button asChild size="sm" className="w-full">
                    <span><Upload className="mr-1.5 size-3.5" /> {mediaStage === "error" ? "Upload a different file" : "Upload media"}</span>
                  </Button>
                </label>
              )}

              {mediaFile && (mediaStage === "uploading" || mediaStage === "uploaded" || mediaStage === "transcribing") && (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{mediaFile.name}</span>
                    <span className="text-muted-foreground">{(mediaFile.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  {mediaStage === "uploading" && (
                    <>
                      <Progress value={mediaProgress} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground">Uploading… {mediaProgress}%</p>
                    </>
                  )}
                  {mediaStage === "uploaded" && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <CheckCircle2 className="size-3 text-primary" /> Uploaded
                    </p>
                  )}
                  {mediaStage === "transcribing" && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Transcribing audio… this can take a minute.
                    </p>
                  )}
                </div>
              )}

              {mediaStage === "error" && mediaError && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
                  <p className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span><strong className="capitalize">{mediaErrorAt}</strong> failed: {mediaError}</span>
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={retryMedia}>
                      <RefreshCw className="mr-1.5 size-3.5" /> Retry
                    </Button>
                    <Button size="sm" variant="ghost" onClick={resetMedia}>
                      <X className="mr-1 size-3.5" /> Cancel
                    </Button>
                  </div>
                </div>
              )}

              {(mediaStage === "ready" || mediaStage === "generating") && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1 text-xs">
                      <FileText className="size-3.5" /> Transcript (editable)
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      {mediaTranscript.length.toLocaleString()} chars
                    </span>
                  </div>
                  <Textarea
                    value={mediaTranscript}
                    onChange={(e) => setMediaTranscript(e.target.value)}
                    rows={10}
                    className="font-mono text-xs"
                    placeholder="Edit the transcript before generating the article…"
                    disabled={mediaStage === "generating"}
                  />
                  {mediaError && mediaErrorAt === "article" && (
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>Article generation failed: {mediaError}</span>
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={doGenerateArticle}
                      disabled={mediaStage === "generating" || !mediaTranscript.trim()}
                    >
                      {mediaStage === "generating" ? (
                        <><Loader2 className="mr-1.5 size-3.5 animate-spin" /> Generating…</>
                      ) : (
                        <><Wand2 className="mr-1.5 size-3.5" /> Generate article</>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={resetMedia}
                      disabled={mediaStage === "generating"}
                    >
                      <X className="mr-1 size-3.5" /> Discard
                    </Button>
                  </div>
                </div>
              )}
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
