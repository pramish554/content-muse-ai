import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Trash2, Upload, Link as LinkIcon, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  ingestKbSource,
  listKbSources,
  deleteKbSource,
  kbChat,
  type KbCitation,
} from "@/lib/kb.functions";

export const Route = createFileRoute("/knowledge")({
  head: () => ({ meta: [{ title: "Knowledge Base — Ink" }] }),
  component: KnowledgeBase,
});

type Msg = { role: "user" | "assistant"; content: string; citations?: KbCitation[] };

function KnowledgeBase() {
  const { user, roles, loading } = useAuth();
  const navigate = useNavigate();
  const isEditor = roles.includes("admin") || roles.includes("editor");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  const ingestFn = useServerFn(ingestKbSource);
  const listFn = useServerFn(listKbSources);
  const delFn = useServerFn(deleteKbSource);
  const chatFn = useServerFn(kbChat);

  const sources = useQuery({
    enabled: !!user,
    queryKey: ["kb-sources"],
    queryFn: () => listFn(),
  });

  // Upload form state
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "url" | "file">("text");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    if (f.size > 2_000_000) {
      toast.error("File too large (max 2MB).");
      return;
    }
    const content = await f.text();
    setText(content);
    if (!title) setTitle(f.name);
  };

  const submitIngest = async () => {
    if (!title.trim()) return toast.error("Add a title.");
    setBusy(true);
    try {
      const payload =
        mode === "url"
          ? { title, source_type: "url" as const, source_url: url, content: undefined }
          : { title, source_type: "text" as const, source_url: null, content: text };
      const res = await ingestFn({ data: payload });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Source indexed.");
        setTitle(""); setUrl(""); setText("");
        if (fileRef.current) fileRef.current.value = "";
        sources.refetch();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this source?")) return;
    await delFn({ data: { id } });
    sources.refetch();
  };

  // Chat state
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const ask = async () => {
    const q = question.trim();
    if (!q || thinking) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setQuestion("");
    setThinking(true);
    try {
      const res = await chatFn({ data: { question: q, history } });
      if (res.error) {
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${res.error}` }]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: res.answer ?? "(no answer)", citations: res.citations },
        ]);
      }
    } finally {
      setThinking(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="p-10 text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="font-serif text-4xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="mt-2 text-muted-foreground">
            Ask questions answered from your indexed site content, with source citations.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Chat */}
          <Card className="flex h-[640px] flex-col overflow-hidden">
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
              {messages.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  Ask anything about your knowledge base. Answers will cite the sources used.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground"
                        : "max-w-[90%] space-y-3"
                    }
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                    {m.citations && m.citations.length > 0 && (
                      <div className="space-y-2 border-l-2 border-border pl-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Sources
                        </p>
                        {m.citations.map((c, j) => (
                          <div key={j} className="text-xs">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">[{j + 1}]</Badge>
                              {c.source_url ? (
                                <a
                                  href={c.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-primary hover:underline"
                                >
                                  {c.source_title}
                                </a>
                              ) : (
                                <span className="font-medium">{c.source_title}</span>
                              )}
                              <span className="text-muted-foreground">
                                · {Math.round(c.similarity * 100)}% match
                              </span>
                            </div>
                            <p className="mt-1 text-muted-foreground line-clamp-2">{c.snippet}…</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching knowledge…
                </div>
              )}
            </div>
            <div className="border-t border-border p-3">
              <form
                onSubmit={(e) => { e.preventDefault(); ask(); }}
                className="flex gap-2"
              >
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a question…"
                  disabled={thinking}
                />
                <Button type="submit" disabled={thinking || !question.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
            </div>
          </Card>

          {/* Sources sidebar */}
          <div className="space-y-4">
            {isEditor && (
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold">Add to knowledge base</h2>
                <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="text"><FileText className="mr-1 size-3" /> Text</TabsTrigger>
                    <TabsTrigger value="url"><LinkIcon className="mr-1 size-3" /> URL</TabsTrigger>
                    <TabsTrigger value="file"><Upload className="mr-1 size-3" /> File</TabsTrigger>
                  </TabsList>
                  <div className="mt-3 space-y-2">
                    <Input
                      placeholder="Title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <TabsContent value="text" className="mt-2 space-y-2">
                      <Textarea
                        placeholder="Paste content…"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={6}
                      />
                    </TabsContent>
                    <TabsContent value="url" className="mt-2 space-y-2">
                      <Input
                        placeholder="https://example.com/page"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </TabsContent>
                    <TabsContent value="file" className="mt-2 space-y-2">
                      <Input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.md,.html,.json,.csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFile(f);
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Plain text formats, up to 2MB.
                      </p>
                    </TabsContent>
                    <Button onClick={submitIngest} disabled={busy} className="w-full">
                      {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                      Index source
                    </Button>
                  </div>
                </Tabs>
              </Card>
            )}

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Sources {sources.data && `(${sources.data.sources.length})`}
              </h2>
              <div className="space-y-2">
                {sources.data?.sources.map((s: any) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 rounded border border-border p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.chunk_count} chunks · {s.source_type}
                      </p>
                    </div>
                    {roles.includes("admin") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(s.id)}
                        className="size-7"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                {sources.data?.sources.length === 0 && (
                  <p className="text-xs text-muted-foreground">No sources yet.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
