
-- Article enhancements
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS parent_article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS keywords jsonb,
  ADD COLUMN IF NOT EXISTS json_ld jsonb,
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.articles
    ADD CONSTRAINT articles_review_state_chk
    CHECK (review_state IN ('none','submitted','approved','changes_requested'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS articles_scheduled_idx ON public.articles(scheduled_at) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS articles_review_idx ON public.articles(review_state);

-- Comments
CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments readable by article author/editors" ON public.comments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.articles a
      WHERE a.id = comments.article_id
        AND (a.author_id = auth.uid()
          OR public.has_role(auth.uid(),'admin')
          OR public.has_role(auth.uid(),'editor')))
  );
CREATE POLICY "Comments insertable by editors/article author" ON public.comments
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = author_id AND EXISTS (
      SELECT 1 FROM public.articles a WHERE a.id = comments.article_id
        AND (a.author_id = auth.uid()
          OR public.has_role(auth.uid(),'admin')
          OR public.has_role(auth.uid(),'editor'))
    )
  );
CREATE POLICY "Comments deletable by own/admin" ON public.comments
  FOR DELETE TO authenticated USING (
    author_id = auth.uid() OR public.has_role(auth.uid(),'admin')
  );

-- Newsletters
CREATE TABLE IF NOT EXISTS public.newsletters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  title text NOT NULL,
  html text NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletters TO authenticated;
GRANT ALL ON public.newsletters TO service_role;
ALTER TABLE public.newsletters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Newsletters readable by author/editor/admin" ON public.newsletters
  FOR SELECT TO authenticated USING (
    auth.uid() = author_id
      OR public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'editor')
  );
CREATE POLICY "Newsletters insert by self" ON public.newsletters
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Newsletters update by author/admin" ON public.newsletters
  FOR UPDATE TO authenticated USING (
    auth.uid() = author_id OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "Newsletters delete by author/admin" ON public.newsletters
  FOR DELETE TO authenticated USING (
    auth.uid() = author_id OR public.has_role(auth.uid(),'admin')
  );

-- AI usage log
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  model text,
  tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AI usage own select" ON public.ai_usage_log
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.has_role(auth.uid(),'admin')
  );
CREATE POLICY "AI usage own insert" ON public.ai_usage_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Article views (anonymous)
CREATE TABLE IF NOT EXISTS public.article_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  visitor_hash text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.article_views TO authenticated;
GRANT INSERT ON public.article_views TO anon, authenticated;
GRANT ALL ON public.article_views TO service_role;
ALTER TABLE public.article_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Views public insert" ON public.article_views
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Views author/admin select" ON public.article_views
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.articles a
      WHERE a.id = article_views.article_id
        AND (a.author_id = auth.uid()
          OR public.has_role(auth.uid(),'admin')
          OR public.has_role(auth.uid(),'editor')))
  );
CREATE INDEX IF NOT EXISTS article_views_article_idx ON public.article_views(article_id, created_at DESC);

-- Increment view counter RPC (callable by anon)
CREATE OR REPLACE FUNCTION public.log_article_view(_slug text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.articles WHERE slug = _slug AND status = 'published' LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE public.articles SET view_count = view_count + 1 WHERE id = v_id;
  INSERT INTO public.article_views (article_id) VALUES (v_id);
END $$;

GRANT EXECUTE ON FUNCTION public.log_article_view(text) TO anon, authenticated;
