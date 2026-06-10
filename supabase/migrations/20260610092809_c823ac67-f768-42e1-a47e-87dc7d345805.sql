
-- =========================================
-- Phase 1: Data foundation
-- =========================================

-- ---------- Extend existing tables ----------
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.kb_sources ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.kb_sources ADD COLUMN IF NOT EXISTS folder_id uuid;
ALTER TABLE public.kb_sources ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE public.kb_sources ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.kb_sources ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS tokens integer DEFAULT 0;

-- Backfill workspace_id on articles / kb_sources from owner's first workspace
UPDATE public.articles a
SET workspace_id = (
  SELECT wm.workspace_id FROM public.workspace_members wm
  WHERE wm.user_id = a.author_id ORDER BY wm.created_at LIMIT 1
)
WHERE a.workspace_id IS NULL AND a.author_id IS NOT NULL;

UPDATE public.kb_sources k
SET workspace_id = (
  SELECT wm.workspace_id FROM public.workspace_members wm
  WHERE wm.user_id = k.user_id ORDER BY wm.created_at LIMIT 1
)
WHERE k.workspace_id IS NULL AND k.user_id IS NOT NULL;

-- updated_at helper already exists: public.update_updated_at_column()

-- ---------- subscribers ----------
CREATE TABLE IF NOT EXISTS public.subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'active', -- active | unsubscribed | bounced
  tags text[] NOT NULL DEFAULT '{}',
  source text, -- form | import | api
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscribers TO authenticated;
GRANT ALL ON public.subscribers TO service_role;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read subscribers" ON public.subscribers FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "editors write subscribers" ON public.subscribers FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::workspace_role[]));
CREATE POLICY "editors update subscribers" ON public.subscribers FOR UPDATE TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::workspace_role[]));
CREATE POLICY "editors delete subscribers" ON public.subscribers FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::workspace_role[]));
CREATE TRIGGER trg_subscribers_updated_at BEFORE UPDATE ON public.subscribers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS subscribers_workspace_idx ON public.subscribers(workspace_id);

-- ---------- subscriber_events ----------
CREATE TABLE IF NOT EXISTS public.subscriber_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.subscribers(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- signup | unsubscribe | open | click
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.subscriber_events TO authenticated;
GRANT ALL ON public.subscriber_events TO service_role;
ALTER TABLE public.subscriber_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read sub events" ON public.subscriber_events FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX IF NOT EXISTS subscriber_events_ws_idx ON public.subscriber_events(workspace_id, created_at DESC);

-- ---------- repurposed_content ----------
CREATE TABLE IF NOT EXISTS public.repurposed_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  article_id uuid REFERENCES public.articles(id) ON DELETE CASCADE,
  format text NOT NULL, -- twitter | linkedin | facebook | newsletter | video_script | podcast | youtube_desc | seo_meta
  content text NOT NULL,
  model text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repurposed_content TO authenticated;
GRANT ALL ON public.repurposed_content TO service_role;
ALTER TABLE public.repurposed_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read repurposed" ON public.repurposed_content FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "writers write repurposed" ON public.repurposed_content FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor','author']::workspace_role[]));
CREATE POLICY "writers delete repurposed" ON public.repurposed_content FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor','author']::workspace_role[]));
CREATE INDEX IF NOT EXISTS repurposed_article_idx ON public.repurposed_content(article_id);

-- ---------- kb_folders ----------
CREATE TABLE IF NOT EXISTS public.kb_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.kb_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_folders TO authenticated;
GRANT ALL ON public.kb_folders TO service_role;
ALTER TABLE public.kb_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read folders" ON public.kb_folders FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "writers write folders" ON public.kb_folders FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor']::workspace_role[]));
CREATE TRIGGER trg_kb_folders_updated_at BEFORE UPDATE ON public.kb_folders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- kb_source_versions ----------
CREATE TABLE IF NOT EXISTS public.kb_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.kb_sources(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  char_count integer DEFAULT 0,
  chunk_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.kb_source_versions TO authenticated;
GRANT ALL ON public.kb_source_versions TO service_role;
ALTER TABLE public.kb_source_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read kb versions" ON public.kb_source_versions FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

-- ---------- automations ----------
CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger text NOT NULL, -- article_published | new_subscriber | kb_source_added
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read automations" ON public.automations FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "admins write automations" ON public.automations FOR ALL TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[])) WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE TRIGGER trg_automations_updated_at BEFORE UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- automation_runs ----------
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'success', -- success | failed
  log jsonb NOT NULL DEFAULT '{}'::jsonb,
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read automation runs" ON public.automation_runs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX IF NOT EXISTS automation_runs_ws_idx ON public.automation_runs(workspace_id, created_at DESC);

-- ---------- generated_media ----------
CREATE TABLE IF NOT EXISTS public.generated_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  kind text NOT NULL, -- featured | illustration | infographic | social
  prompt text NOT NULL,
  url text NOT NULL,
  model text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_media TO authenticated;
GRANT ALL ON public.generated_media TO service_role;
ALTER TABLE public.generated_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read media" ON public.generated_media FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "writers write media" ON public.generated_media FOR INSERT TO authenticated WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor','author']::workspace_role[]));
CREATE POLICY "writers delete media" ON public.generated_media FOR DELETE TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin','editor','author']::workspace_role[]));

-- ---------- audit_logs ----------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner','admin']::workspace_role[]));
CREATE INDEX IF NOT EXISTS audit_logs_ws_idx ON public.audit_logs(workspace_id, created_at DESC);

-- ---------- workspace_plans ----------
CREATE TABLE IF NOT EXISTS public.workspace_plans (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free', -- free | pro | team
  status text NOT NULL DEFAULT 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workspace_plans TO authenticated;
GRANT ALL ON public.workspace_plans TO service_role;
ALTER TABLE public.workspace_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read plan" ON public.workspace_plans FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_workspace_plans_updated_at BEFORE UPDATE ON public.workspace_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed plans for existing workspaces
INSERT INTO public.workspace_plans (workspace_id, plan)
SELECT id, 'free' FROM public.workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- ---------- usage_counters ----------
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  month text NOT NULL, -- YYYY-MM
  ai_articles integer NOT NULL DEFAULT 0,
  chat_messages integer NOT NULL DEFAULT 0,
  images_generated integer NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, month)
);
GRANT SELECT, INSERT, UPDATE ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read usage" ON public.usage_counters FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_usage_counters_updated_at BEFORE UPDATE ON public.usage_counters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- agent_runs ----------
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_type text NOT NULL, -- strategist | seo | editor | researcher | social
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens integer DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read agent runs" ON public.agent_runs FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX IF NOT EXISTS agent_runs_ws_idx ON public.agent_runs(workspace_id, created_at DESC);

-- ---------- Helper: increment usage counter ----------
CREATE OR REPLACE FUNCTION public.increment_usage(_workspace uuid, _field text, _amount integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := to_char(now(), 'YYYY-MM');
BEGIN
  INSERT INTO public.usage_counters (workspace_id, month) VALUES (_workspace, v_month)
  ON CONFLICT (workspace_id, month) DO NOTHING;
  IF _field = 'ai_articles' THEN
    UPDATE public.usage_counters SET ai_articles = ai_articles + _amount WHERE workspace_id = _workspace AND month = v_month;
  ELSIF _field = 'chat_messages' THEN
    UPDATE public.usage_counters SET chat_messages = chat_messages + _amount WHERE workspace_id = _workspace AND month = v_month;
  ELSIF _field = 'images_generated' THEN
    UPDATE public.usage_counters SET images_generated = images_generated + _amount WHERE workspace_id = _workspace AND month = v_month;
  ELSIF _field = 'tokens' THEN
    UPDATE public.usage_counters SET tokens = tokens + _amount WHERE workspace_id = _workspace AND month = v_month;
  END IF;
END $$;
