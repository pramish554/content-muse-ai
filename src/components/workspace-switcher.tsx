import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export function WorkspaceSwitcher() {
  const { workspaces, active, setActive } = useWorkspace();
  if (!active) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[220px] justify-between gap-2">
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => setActive(w.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{w.name}</span>
            <span className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] capitalize">{w.role}</Badge>
              {w.id === active.id && <Check className="size-3.5" />}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <Link to="/workspaces">
          <DropdownMenuItem>
            <Plus className="mr-2 size-4" /> New workspace
          </DropdownMenuItem>
        </Link>
        <Link to="/workspaces/$id/settings" params={{ id: active.id }}>
          <DropdownMenuItem>
            <Settings className="mr-2 size-4" /> Workspace settings
          </DropdownMenuItem>
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
