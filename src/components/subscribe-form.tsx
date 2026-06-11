import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Props {
  workspaceId: string;
  source?: string;
  className?: string;
  placeholder?: string;
  buttonLabel?: string;
}

export function SubscribeForm({
  workspaceId,
  source = "embed",
  className,
  placeholder = "you@example.com",
  buttonLabel = "Subscribe",
}: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const res = await fetch("/api/public/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, email, name: name || undefined, source }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setDone(true);
      setEmail("");
      setName("");
      toast.success("Subscribed!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground">Thanks for subscribing — check your inbox.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={className}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="sm:max-w-[180px]"
        />
        <Input
          type="email"
          required
          placeholder={placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={255}
        />
        <Button type="submit" disabled={loading}>
          {loading ? "..." : buttonLabel}
        </Button>
      </div>
    </form>
  );
}
