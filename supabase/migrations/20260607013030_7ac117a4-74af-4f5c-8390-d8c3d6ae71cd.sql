
create extension if not exists vector;

create table public.kb_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  source_type text not null default 'text',
  source_url text,
  char_count int not null default 0,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.kb_sources to authenticated;
grant all on public.kb_sources to service_role;
alter table public.kb_sources enable row level security;
create policy "kb_sources read all authenticated" on public.kb_sources for select to authenticated using (true);
create policy "kb_sources insert editors" on public.kb_sources for insert to authenticated with check (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'editor')
);
create policy "kb_sources update editors" on public.kb_sources for update to authenticated using (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'editor')
);
create policy "kb_sources delete admin" on public.kb_sources for delete to authenticated using (
  public.has_role(auth.uid(),'admin')
);
create trigger kb_sources_updated before update on public.kb_sources
  for each row execute function public.update_updated_at_column();

create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.kb_sources(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.kb_chunks to authenticated;
grant all on public.kb_chunks to service_role;
alter table public.kb_chunks enable row level security;
create policy "kb_chunks read all authenticated" on public.kb_chunks for select to authenticated using (true);
create policy "kb_chunks write editors" on public.kb_chunks for insert to authenticated with check (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'editor')
);
create policy "kb_chunks delete editors" on public.kb_chunks for delete to authenticated using (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'editor')
);
create index kb_chunks_embedding_idx on public.kb_chunks using hnsw (embedding vector_cosine_ops);
create index kb_chunks_source_idx on public.kb_chunks(source_id);

create or replace function public.match_kb_chunks(query_embedding vector(1536), match_count int default 5)
returns table (
  id uuid,
  source_id uuid,
  chunk_index int,
  content text,
  similarity float,
  source_title text,
  source_url text
)
language sql stable
security definer
set search_path = public
as $$
  select c.id, c.source_id, c.chunk_index, c.content,
         1 - (c.embedding <=> query_embedding) as similarity,
         s.title as source_title, s.source_url
  from public.kb_chunks c
  join public.kb_sources s on s.id = c.source_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
