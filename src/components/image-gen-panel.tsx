import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateArticleImage, listGeneratedMedia } from "@/lib/media-gen.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ImagePlus, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  articleId: string;
  workspaceId: string | null;
  onUseAsCover?: (url: string) => void;
}

interface Item {
  id: string;
  url: string;
  prompt: string;
  kind: string;
  created_at: string;
}

export function ImageGenPanel({ articleId, workspaceId, onUseAsCover }: Props) {
  const callGen = useServerFn(generateArticleImage);
  const callList = useServerFn(listGeneratedMedia);

  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  const refresh = async () => {
    const res = await callList({ data: { articleId } });
    if (!res.error) setItems(res.items as Item[]);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [articleId]);

  const run = async () => {
    if (!workspaceId) return toast.error("No active workspace");
    if (!prompt.trim()) return toast.error("Describe the image");
    setRunning(true);
    try {
      const res = await callGen({
        data: { articleId, workspaceId, prompt: prompt.trim(), kind: "cover" },
      });
      if (res.error || !res.url) return toast.error(res.error ?? "Failed");
      toast.success("Image generated");
      if (res.row) setItems((prev) => [res.row as Item, ...prev]);
      setPrompt("");
    } finally { setRunning(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="flex items-center gap-1.5 font-serif text-lg font-semibold">
        <ImagePlus className="size-4 text-primary" /> Generate image
      </h3>
      <p className="text-xs text-muted-foreground">
        Describe a cover or inline image. Generated images are stored in your workspace.
      </p>
      <div className="space-y-2">
        <Label className="text-xs">Prompt</Label>
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. minimalist illustration of a typewriter at golden hour"
          disabled={running}
        />
        <Button size="sm" className="w-full" onClick={run} disabled={running || !workspaceId}>
          {running ? (
            <><Loader2 className="mr-1.5 size-3.5 animate-spin" /> Generating…</>
          ) : (
            <><ImagePlus className="mr-1.5 size-3.5" /> Generate</>
          )}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          {items.map((it) => (
            <div key={it.id} className="space-y-1.5 rounded-md border border-border bg-background/60 p-1.5">
              <img
                src={it.url}
                alt={it.prompt}
                className="aspect-square w-full rounded object-cover"
                loading="lazy"
              />
              <p className="line-clamp-2 text-[10px] text-muted-foreground">{it.prompt}</p>
              <div className="flex gap-1">
                {onUseAsCover && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 px-1.5 text-[10px]"
                    onClick={() => { onUseAsCover(it.url); toast.success("Set as cover"); }}
                  >
                    Use as cover
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1.5"
                  onClick={async () => { await navigator.clipboard.writeText(it.url); toast.success("URL copied"); }}
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
