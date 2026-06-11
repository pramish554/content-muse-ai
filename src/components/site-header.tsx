import { Link } from "@tanstack/react-router";
import { Moon, Sun, PenLine, LogOut, Shield, MessagesSquare, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";

export function SiteHeader() {
  const { user, roles, signOut } = useAuth();
  const isAdmin = roles.includes("admin");
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-baseline gap-2 font-serif text-2xl font-semibold tracking-tight">
          <span className="text-primary">Ink</span>
          <span className="text-muted-foreground text-sm font-sans">— editorial CMS</span>
        </Link>
        <nav className="flex items-center gap-2">
          {user && <WorkspaceSwitcher />}
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          {user ? (
            <>
              <Link to="/dashboard">
                <Button variant="ghost" size="sm">
                  <PenLine className="mr-1.5 size-4" /> Dashboard
                </Button>
              </Link>
              <Link to="/knowledge">
                <Button variant="ghost" size="sm">
                  <MessagesSquare className="mr-1.5 size-4" /> Ask KB
                </Button>
              </Link>
              <Link to="/subscribers">
                <Button variant="ghost" size="sm">
                  <Users className="mr-1.5 size-4" /> Subscribers
                </Button>
              </Link>
              {isAdmin && (
                <Link to="/admin">
                  <Button variant="ghost" size="sm">
                    <Shield className="mr-1.5 size-4" /> Admin
                  </Button>
                </Link>
              )}
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="size-4" />
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm">Sign in</Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
