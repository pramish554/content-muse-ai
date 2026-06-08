
-- Roles enum
CREATE TYPE public.workspace_role AS ENUM ('owner','admin','editor','author','viewer');

-- Workspaces
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Members
CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'author',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- Invitations
CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'author',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  invited_by uuid NOT NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invitations TO authenticated;
GRANT ALL ON public.workspace_invitations TO service_role;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace AND user_id = _user
  );
$$;

CREATE OR REPLACE FUNCTION public.workspace_role_of(_workspace uuid, _user uuid)
RETURNS public.workspace_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.workspace_members
  WHERE workspace_id = _workspace AND user_id = _user LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_workspace uuid, _user uuid, _roles public.workspace_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace AND user_id = _user AND role = ANY(_roles)
  );
$$;

-- RLS: workspaces
CREATE POLICY "Members can view workspace" ON public.workspaces FOR SELECT TO authenticated
  USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "Anyone authenticated can create workspace" ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners/admins update workspace" ON public.workspaces FOR UPDATE TO authenticated
  USING (public.has_workspace_role(id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]));
CREATE POLICY "Owner deletes workspace" ON public.workspaces FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- RLS: members
CREATE POLICY "Members can view members" ON public.workspace_members FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Owners/admins manage members" ON public.workspace_members FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]));

-- RLS: invitations
CREATE POLICY "Admins view invitations" ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]));
CREATE POLICY "Admins create invitations" ON public.workspace_invitations FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]) AND invited_by = auth.uid());
CREATE POLICY "Admins delete invitations" ON public.workspace_invitations FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]));

-- updated_at trigger
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create personal workspace on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
  v_slug text;
  v_ws uuid;
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'author');

  v_name := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)) || '''s Workspace';
  v_slug := lower(regexp_replace(split_part(NEW.email,'@',1),'[^a-z0-9]+','-','g')) || '-' || substr(NEW.id::text,1,8);
  INSERT INTO public.workspaces (name, slug, owner_id) VALUES (v_name, v_slug, NEW.id) RETURNING id INTO v_ws;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_ws, NEW.id, 'owner');
  RETURN NEW;
END $$;

-- Backfill existing users into personal workspaces
DO $$
DECLARE r record; v_ws uuid; v_slug text;
BEGIN
  FOR r IN SELECT u.id, u.email FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.owner_id = u.id)
  LOOP
    v_slug := lower(regexp_replace(split_part(COALESCE(r.email,'user'),'@',1),'[^a-z0-9]+','-','g')) || '-' || substr(r.id::text,1,8);
    INSERT INTO public.workspaces (name, slug, owner_id)
      VALUES (split_part(COALESCE(r.email,'user'),'@',1) || '''s Workspace', v_slug, r.id)
      RETURNING id INTO v_ws;
    INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_ws, r.id, 'owner');
  END LOOP;
END $$;

-- Scope existing tables
ALTER TABLE public.articles ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.kb_sources ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.newsletters ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.categories ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- Backfill: each row gets its owner's first workspace
UPDATE public.articles a SET workspace_id = (SELECT id FROM public.workspaces w WHERE w.owner_id = a.author_id LIMIT 1)
  WHERE a.workspace_id IS NULL;
UPDATE public.kb_sources k SET workspace_id = (SELECT id FROM public.workspaces w WHERE w.owner_id = k.user_id LIMIT 1)
  WHERE k.workspace_id IS NULL;
UPDATE public.newsletters n SET workspace_id = (SELECT id FROM public.workspaces w WHERE w.owner_id = n.author_id LIMIT 1)
  WHERE n.workspace_id IS NULL;
-- Categories: assign to any workspace if orphaned (best-effort; categories were global before)
UPDATE public.categories SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
  WHERE workspace_id IS NULL;

CREATE INDEX idx_articles_workspace ON public.articles(workspace_id);
CREATE INDEX idx_kb_sources_workspace ON public.kb_sources(workspace_id);
CREATE INDEX idx_newsletters_workspace ON public.newsletters(workspace_id);
CREATE INDEX idx_categories_workspace ON public.categories(workspace_id);

-- Extend RLS on scoped tables: members of the workspace can read/write (combined with existing policies)
CREATE POLICY "Workspace members read articles" ON public.articles FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace authors+ insert articles" ON public.articles FOR INSERT TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor','author']::public.workspace_role[]));
CREATE POLICY "Workspace editors+ update articles" ON public.articles FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::public.workspace_role[]) OR author_id = auth.uid());
CREATE POLICY "Workspace admins delete articles" ON public.articles FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::public.workspace_role[]) OR author_id = auth.uid());

CREATE POLICY "Workspace members read kb_sources" ON public.kb_sources FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace editors+ write kb_sources" ON public.kb_sources FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::public.workspace_role[]));
CREATE POLICY "Workspace editors+ update kb_sources" ON public.kb_sources FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::public.workspace_role[]));
CREATE POLICY "Workspace admins delete kb_sources" ON public.kb_sources FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::public.workspace_role[]));
