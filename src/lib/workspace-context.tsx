import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { listMyWorkspaces } from "@/lib/workspaces.functions";

export type WorkspaceRole = "owner" | "admin" | "editor" | "author" | "viewer";
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  owner_id: string;
  role: WorkspaceRole;
}

interface WorkspaceCtx {
  workspaces: Workspace[];
  active: Workspace | null;
  loading: boolean;
  setActive: (id: string) => void;
  refresh: () => Promise<void>;
  can: (action: "manage" | "write" | "edit" | "read") => boolean;
}

const Ctx = createContext<WorkspaceCtx>({
  workspaces: [],
  active: null,
  loading: true,
  setActive: () => {},
  refresh: async () => {},
  can: () => false,
});

const STORAGE_KEY = "ink.activeWorkspaceId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const listFn = useServerFn(listMyWorkspaces);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    try {
      const { workspaces: ws } = await listFn();
      setWorkspaces(ws as Workspace[]);
      if (ws.length && (!activeId || !ws.find((w: Workspace) => w.id === activeId))) {
        const next = ws[0].id;
        setActiveId(next);
        localStorage.setItem(STORAGE_KEY, next);
      }
    } finally {
      setLoading(false);
    }
  }, [user, listFn, activeId]);

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [user?.id]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  const can = useCallback(
    (action: "manage" | "write" | "edit" | "read") => {
      if (!active) return false;
      const r = active.role;
      if (action === "read") return true;
      if (action === "write") return ["owner", "admin", "editor", "author"].includes(r);
      if (action === "edit") return ["owner", "admin", "editor"].includes(r);
      if (action === "manage") return ["owner", "admin"].includes(r);
      return false;
    },
    [active],
  );

  return (
    <Ctx.Provider value={{ workspaces, active, loading, setActive, refresh, can }}>
      {children}
    </Ctx.Provider>
  );
}

export const useWorkspace = () => useContext(Ctx);
