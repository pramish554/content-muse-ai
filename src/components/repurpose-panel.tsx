import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  repurposeArticle,
  listRepurposed,
  deleteRepurposed,
  REPURPOSE_FORMATS,
  type RepurposeFormat,
} from "@/lib/repurpose.functions";
import { Button } from "@/components/ui/button";
import { Loader2, Recycle, Copy, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

interface Props {
  articleId: string;
}

interface Item {
  id: string;
  format: string;
  content: string;
  created_at: string;
}

export function RepurposePanel({ articleId }: Props) {
  const callRepurpose = useServerFn(repurposeArticle);
  const callList = useServerFn(listRepurposed);
  const callDelete = useServerFn(deleteRepurposed);

  const [format, setFormat] = useState<RepurposeFormat>("twitter_thread");
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = async () => {
    const res = await callList({ data: { articleId } });
    if (!res.error) setItems(res.items as Item[]);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [articleId]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await callRepurpose({ data: { articleId, format } });
      if (res.error) return toast.error(res.error);
      toast.success(`Repurposed as ${REPURPOSE_FORMATS[format]}`);
      if (res.row) {
        setItems((prev) => [res.row as Item, ...prev]);
        setOpenId((res.row as Item).id);
      }
    } finally { setRunning(false); }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const remove = async (id: string) => {
    const res = await callDelete({ data: { id } });
    if (res.error) return toast.error(res.error);
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="flex items-center gap-1.5 font-serif text-lg font-semibold">
        <Recycle className="size-4 text-primary" /> Repurpose
      </h3>
      <p className="text-xs text-muted-foreground">
        Turn this article into social posts, newsletters, scripts and more.
      </p>
      <div className="flex gap-2">
        <Select value={format} onValueChange={(v) => setFormat(v as RepurposeFormat)}>
          <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(REPURPOSE_FORMATS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : "Generate"}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="space-y-2 pt-1">
          {items.map((it) => {
            const open = openId === it.id;
            return (
              <div key={it.id} className="rounded-md border border-border bg-background/60">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs"
                  onClick={() => setOpenId(open ? null : it.id)}
                >
                  <span className="font-medium">
                    {REPURPOSE_FORMATS[it.format as RepurposeFormat] ?? it.format}
                  </span>
                  <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="space-y-2 border-t border-border px-2.5 py-2">
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] leading-relaxed">
                      {it.content}
                    </pre>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(it.content)}>
                        <Copy className="mr-1 size-3.5" /> Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(it.id)}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
