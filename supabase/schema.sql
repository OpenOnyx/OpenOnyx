-- ============================================================================
-- OpenObsidian Schema v2
-- Self-contained migration for user-owned Supabase databases
--
-- HOW TO USE:
-- 1. Open your Supabase project dashboard
-- 2. Go to SQL Editor
-- 3. Paste this entire file
-- 4. Click "Run"
--
-- This migration is IDEMPOTENT -- safe to run multiple times.
-- It will NOT overwrite or modify any existing user data.
-- ============================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA extensions;

-- 2. Users table (synced from auth.users via trigger)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 3. Vaults table (for real-time collaboration)
CREATE TABLE IF NOT EXISTS public.vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vaults ENABLE ROW LEVEL SECURITY;

-- 3a. Vault Collaborators
CREATE TABLE IF NOT EXISTS public.vault_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(vault_id, user_id)
);
ALTER TABLE public.vault_collaborators ENABLE ROW LEVEL SECURITY;

-- 3b. Vault Invites
CREATE TABLE IF NOT EXISTS public.vault_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  invited_user_email text NOT NULL,
  invited_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vault_invites ENABLE ROW LEVEL SECURITY;

-- 3c. Vault Presence
CREATE TABLE IF NOT EXISTS public.vault_presence (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vault_id uuid NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  active_note_id uuid,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vault_id)
);
ALTER TABLE public.vault_presence ENABLE ROW LEVEL SECURITY;

-- 4. Spaces table
CREATE TABLE IF NOT EXISTS public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  helps_with text[] DEFAULT '{}',
  is_public boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('local', 'private', 'public')),
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('processing', 'ready', 'error')),
  forked_from uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

-- 5. Notes table
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE,
  vault_id uuid REFERENCES public.vaults(id) ON DELETE CASCADE,
  last_client_id text,
  version integer NOT NULL DEFAULT 0,
  last_modified timestamptz NOT NULL DEFAULT now(),
  client_id text,
  content_hash text NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  title text NOT NULL,
  path text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false,
  is_canvas boolean NOT NULL DEFAULT false
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS last_modified timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

-- 5. Note chunks table (for embeddings / RAG)
CREATE TABLE IF NOT EXISTS public.note_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(384),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.note_chunks ENABLE ROW LEVEL SECURITY;

-- 6. Space embeddings (for explore/discovery)
CREATE TABLE IF NOT EXISTS public.space_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE UNIQUE,
  content text NOT NULL,
  embedding vector(384),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.space_embeddings ENABLE ROW LEVEL SECURITY;

-- 7. Space stats
CREATE TABLE IF NOT EXISTS public.space_stats (
  space_id uuid PRIMARY KEY REFERENCES public.spaces(id) ON DELETE CASCADE,
  views integer NOT NULL DEFAULT 0,
  forks integer NOT NULL DEFAULT 0,
  upvotes integer NOT NULL DEFAULT 0,
  score double precision DEFAULT 0
);
ALTER TABLE public.space_stats ENABLE ROW LEVEL SECURITY;

-- 8. Space votes
CREATE TABLE IF NOT EXISTS public.space_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, space_id)
);
ALTER TABLE public.space_votes ENABLE ROW LEVEL SECURITY;

-- 9. Space invites (for collaboration invitations)
CREATE TABLE IF NOT EXISTS public.space_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_email text NOT NULL,
  role text NOT NULL DEFAULT 'editor'
    CHECK (role IN ('editor', 'viewer')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.space_invites ENABLE ROW LEVEL SECURITY;

-- 10. Space collaborators (who has access to a space)
CREATE TABLE IF NOT EXISTS public.space_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor'
    CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, user_id)
);
ALTER TABLE public.space_collaborators ENABLE ROW LEVEL SECURITY;

-- 11. Linked vaults (maps local vault paths to cloud spaces)
CREATE TABLE IF NOT EXISTS public.linked_vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  local_vault_path text NOT NULL,
  is_bootstrapping boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.linked_vaults ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_spaces_owner_updated ON public.spaces (owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_spaces_visibility ON public.spaces (visibility);
CREATE INDEX IF NOT EXISTS idx_notes_space_updated ON public.notes (space_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_space_path_version ON public.notes (space_id, path, version);
CREATE INDEX IF NOT EXISTS idx_notes_deleted ON public.notes (deleted) WHERE deleted = true;
CREATE INDEX IF NOT EXISTS idx_note_chunks_note_updated ON public.note_chunks (note_id, updated_at);

-- Collaboration indexes
CREATE INDEX IF NOT EXISTS idx_space_invites_receiver_email ON public.space_invites (receiver_email);
CREATE INDEX IF NOT EXISTS idx_space_invites_receiver_id ON public.space_invites (receiver_id);
CREATE INDEX IF NOT EXISTS idx_linked_vaults_space_user ON public.linked_vaults (space_id, user_id);
CREATE INDEX IF NOT EXISTS idx_space_collaborators_space_user ON public.space_collaborators (space_id, user_id);
CREATE INDEX IF NOT EXISTS idx_space_collaborators_user ON public.space_collaborators (user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- AUTO-UPDATE TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_vaults_updated_at ON public.vaults;
CREATE TRIGGER trg_vaults_updated_at
  BEFORE UPDATE ON public.vaults FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_spaces_updated_at ON public.spaces;
CREATE TRIGGER trg_spaces_updated_at
  BEFORE UPDATE ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notes_updated_at ON public.notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_note_chunks_updated_at ON public.note_chunks;
CREATE TRIGGER trg_note_chunks_updated_at
  BEFORE UPDATE ON public.note_chunks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- AUTH TRIGGER (auto-create user profile on signup)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at)
  VALUES (NEW.id, NEW.email, now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Lock down internal functions from API exposure
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- COLLABORATION HELPER FUNCTION
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER function that bypasses RLS to check space membership.
-- This prevents infinite recursion when policies on notes/linked_vaults/etc.
-- need to verify the caller is a space collaborator.

CREATE OR REPLACE FUNCTION public.is_space_member(p_space_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.space_collaborators
    WHERE space_id = p_space_id AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.spaces
    WHERE id = p_space_id AND owner_id = auth.uid()
  );
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY POLICIES
-- ════════════════════════════════════════════════════════════════════════════

-- Users
DO $$ BEGIN
  CREATE POLICY "Users can view their own profile"
    ON public.users FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own profile"
    ON public.users FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own profile"
    ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow authenticated users to look up other profiles (needed for collaborator display)
DO $$ BEGIN
  CREATE POLICY "Allow authenticated users to view profiles"
    ON public.users FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Spaces
DO $$ BEGIN
  CREATE POLICY "Users can view their own spaces"
    ON public.spaces FOR SELECT USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public spaces are viewable by everyone"
    ON public.spaces FOR SELECT USING (visibility = 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Collaborators can view shared private spaces"
    ON public.spaces FOR SELECT USING (
      public.is_space_member(spaces.id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own spaces"
    ON public.spaces FOR INSERT WITH CHECK (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own spaces"
    ON public.spaces FOR UPDATE USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own spaces"
    ON public.spaces FOR DELETE USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notes
DO $$ BEGIN
  CREATE POLICY "Notes are viewable if space is public or owned"
    ON public.notes FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = notes.space_id
          AND (spaces.visibility = 'public' OR spaces.owner_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert notes to their own spaces"
    ON public.notes FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = notes.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update notes in their own spaces"
    ON public.notes FOR UPDATE USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = notes.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete notes in their own spaces"
    ON public.notes FOR DELETE USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = notes.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Note chunks
DO $$ BEGIN
  CREATE POLICY "Users can insert chunks to their own notes"
    ON public.note_chunks FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = note_chunks.space_id AND spaces.owner_id = auth.uid())
    );

  CREATE POLICY "Users can update chunks in their own notes"
    ON public.note_chunks FOR UPDATE USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = note_chunks.space_id AND spaces.owner_id = auth.uid())
    );

  CREATE POLICY "Users can delete chunks in their own notes"
    ON public.note_chunks FOR DELETE USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = note_chunks.space_id AND spaces.owner_id = auth.uid())
    );

  CREATE POLICY "Chunks viewable if space public or owned"
    ON public.note_chunks FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = note_chunks.space_id 
        AND (spaces.visibility = 'public' OR spaces.owner_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Space embeddings
DO $$ BEGIN
  CREATE POLICY "Space embeddings readable if space accessible"
    ON public.space_embeddings FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = space_embeddings.space_id
          AND (spaces.visibility = 'public' OR spaces.owner_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can manage embeddings for own spaces"
    ON public.space_embeddings FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = space_embeddings.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update embeddings for own spaces"
    ON public.space_embeddings FOR UPDATE USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = space_embeddings.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete embeddings for own spaces"
    ON public.space_embeddings FOR DELETE USING (
      EXISTS (SELECT 1 FROM public.spaces
        WHERE spaces.id = space_embeddings.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Space stats
DO $$ BEGIN
  CREATE POLICY "Space stats viewable by everyone"
    ON public.space_stats FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Space votes
DO $$ BEGIN
  CREATE POLICY "Users can view all votes"
    ON public.space_votes FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own votes"
    ON public.space_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own votes"
    ON public.space_votes FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own votes"
    ON public.space_votes FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.increment_space_views(p_space_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.space_stats (space_id, views) VALUES (p_space_id, 1)
  ON CONFLICT (space_id) DO UPDATE SET views = space_stats.views + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_space_forks(space_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.space_stats (space_id, forks) VALUES (space_id, 1)
  ON CONFLICT (space_id) DO UPDATE SET forks = space_stats.forks + 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_space_forks(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.vote_on_space(p_space_id uuid, p_value smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.space_votes (user_id, space_id, value)
  VALUES (auth.uid(), p_space_id, p_value)
  ON CONFLICT (user_id, space_id) DO UPDATE SET value = p_value;

  UPDATE public.space_stats
  SET upvotes = (SELECT COALESCE(SUM(value), 0) FROM public.space_votes WHERE space_id = p_space_id)
  WHERE space_id = p_space_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vote_on_space(uuid, smallint) FROM anon;

-- Vector search: match note chunks by embedding similarity
CREATE OR REPLACE FUNCTION public.match_note_chunks(
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  filter_space_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, note_id uuid, note_title text, content text, similarity float)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT nc.id, nc.note_id, n.title, nc.content,
    1 - (nc.embedding <=> query_embedding) AS similarity
  FROM public.note_chunks nc
  JOIN public.notes n ON n.id = nc.note_id
  WHERE nc.embedding IS NOT NULL
    AND n.deleted = false
    AND (filter_space_id IS NULL OR n.space_id = filter_space_id)
    AND 1 - (nc.embedding <=> query_embedding) > match_threshold
  ORDER BY nc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Vector search: match spaces by embedding similarity
CREATE OR REPLACE FUNCTION public.match_spaces(
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
RETURNS TABLE (space_id uuid, title text, description text, similarity float)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT se.space_id, s.title, s.description,
    1 - (se.embedding <=> query_embedding) AS similarity
  FROM public.space_embeddings se
  JOIN public.spaces s ON s.id = se.space_id
  WHERE se.embedding IS NOT NULL
    AND s.visibility = 'public'
    AND 1 - (se.embedding <=> query_embedding) > match_threshold
  ORDER BY se.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;




-- ════════════════════════════════════════════════════════════════════════════
-- COLLABORATION RLS
-- ════════════════════════════════════════════════════════════════════════════

-- Space Invites
DO $$ BEGIN
  CREATE POLICY "Space owners can insert invites"
    ON public.space_invites FOR INSERT WITH CHECK (
      auth.uid() = sender_id
      AND EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = space_invites.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Senders can view their sent invites"
    ON public.space_invites FOR SELECT USING (auth.uid() = sender_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Receivers can view invites sent to them"
    ON public.space_invites FOR SELECT USING (
      receiver_email = (SELECT email FROM public.users WHERE id = auth.uid())
      OR receiver_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Senders can update their invites"
    ON public.space_invites FOR UPDATE USING (auth.uid() = sender_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Receivers can update invites sent to them"
    ON public.space_invites FOR UPDATE USING (
      receiver_email = (SELECT email FROM public.users WHERE id = auth.uid())
      OR receiver_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Senders can delete their invites"
    ON public.space_invites FOR DELETE USING (auth.uid() = sender_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Space Collaborators
-- NOTE: This policy must NOT reference space_collaborators itself (causes infinite recursion).
-- Users can see: (a) their own collaborator rows, (b) all collaborators for spaces they own.
DO $$ BEGIN
  CREATE POLICY "Collaborators can view space collaborators"
    ON public.space_collaborators FOR SELECT USING (
      public.is_space_member(space_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Space owners can insert collaborators"
    ON public.space_collaborators FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = space_collaborators.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Space owners can delete collaborators"
    ON public.space_collaborators FOR DELETE USING (
      EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = space_collaborators.space_id AND spaces.owner_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notes collaboration: collaborators can CRUD notes in shared spaces
-- Uses is_space_member() to avoid recursive RLS on space_collaborators.
DO $$ BEGIN
  CREATE POLICY "Collaborators can view notes in shared spaces"
    ON public.notes FOR SELECT USING (
      public.is_space_member(notes.space_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Collaborators can insert notes in shared spaces"
    ON public.notes FOR INSERT WITH CHECK (
      public.is_space_member(notes.space_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Collaborators can update notes in shared spaces"
    ON public.notes FOR UPDATE USING (
      public.is_space_member(notes.space_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Collaborators can delete notes in shared spaces"
    ON public.notes FOR DELETE USING (
      public.is_space_member(notes.space_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Linked vaults
DO $$ BEGIN
  CREATE POLICY "Users can view their own linked vaults"
    ON public.linked_vaults FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Collaborators can view linked vaults for their spaces"
    ON public.linked_vaults FOR SELECT USING (
      public.is_space_member(linked_vaults.space_id)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own linked vaults"
    ON public.linked_vaults FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own linked vaults"
    ON public.linked_vaults FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own linked vaults"
    ON public.linked_vaults FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Vault presence
DO $$ BEGIN
  CREATE POLICY "Users can view presence in their collaborative spaces"
    ON public.vault_presence FOR SELECT USING (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM public.linked_vaults lv
        WHERE lv.user_id = vault_presence.user_id
          AND public.is_space_member(lv.space_id)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert their own presence"
    ON public.vault_presence FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update their own presence"
    ON public.vault_presence FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete their own presence"
    ON public.vault_presence FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- COLLABORATION RPC FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════════

-- Accept a space invite: validates receiver, updates invite, creates collaborator
CREATE OR REPLACE FUNCTION public.accept_space_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite record;
BEGIN
  SELECT * INTO v_invite FROM public.space_invites WHERE id = p_invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;

  -- Verify the current user is the receiver
  IF v_invite.receiver_id IS NOT NULL AND v_invite.receiver_id != auth.uid() THEN
    RAISE EXCEPTION 'Not your invite';
  END IF;
  IF v_invite.receiver_id IS NULL THEN
    IF v_invite.receiver_email != (SELECT email FROM public.users WHERE id = auth.uid()) THEN
      RAISE EXCEPTION 'Not your invite';
    END IF;
  END IF;

  UPDATE public.space_invites SET status = 'accepted', receiver_id = auth.uid() WHERE id = p_invite_id;

  INSERT INTO public.space_collaborators (space_id, user_id, role)
  VALUES (v_invite.space_id, auth.uid(), v_invite.role)
  ON CONFLICT (space_id, user_id) DO NOTHING;
END;
$$;

-- Reject a space invite
CREATE OR REPLACE FUNCTION public.reject_space_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.space_invites SET status = 'rejected'
  WHERE id = p_invite_id
    AND (receiver_id = auth.uid()
         OR receiver_email = (SELECT email FROM public.users WHERE id = auth.uid()));
END;
$$;

-- Get a full snapshot of a space (notes + paths) for vault reconstruction
CREATE OR REPLACE FUNCTION public.get_space_snapshot(p_space_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.spaces WHERE id = p_space_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.space_collaborators WHERE space_id = p_space_id AND user_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.space_invites WHERE space_id = p_space_id AND status = 'accepted'
      AND (receiver_id = auth.uid() OR receiver_email = (SELECT email FROM public.users WHERE id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'space', (SELECT row_to_json(s) FROM public.spaces s WHERE s.id = p_space_id),
    'notes', COALESCE((
      SELECT jsonb_agg(row_to_json(n))
      FROM public.notes n
      WHERE n.space_id = p_space_id AND n.deleted = false
    ), '[]'::jsonb),
    'paths', COALESCE((
      SELECT jsonb_agg(DISTINCT n.path)
      FROM public.notes n
      WHERE n.space_id = p_space_id AND n.deleted = false AND n.path IS NOT NULL AND n.path != ''
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME PUBLICATION
-- ════════════════════════════════════════════════════════════════════════════
-- Enable realtime for collaboration-critical tables.
-- Run this AFTER tables exist. Safe to re-run.

-- ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.space_invites;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.vault_presence;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.space_collaborators;


-- ════════════════════════════════════════════════════════════════════════════
-- DONE
-- ════════════════════════════════════════════════════════════════════════════
-- Schema installation complete. Your Supabase project is now ready for
-- OpenObsidian. Configure the app with your project URL and anon key.
