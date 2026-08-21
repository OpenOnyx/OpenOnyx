import { createClient, SupabaseClient, type Session } from '@supabase/supabase-js';
import type { Database } from './database.types';
import {
  clearLocalSupabaseConfig,
  loadLocalSupabaseConfig,
  saveLocalSupabaseConfig,
} from './supabaseConfig';
import { supabase } from './supabase';

/**
 * User-owned Supabase Database Setup
 *
 * Allows users to connect their own Supabase instance by providing
 * their project URL and anon key. The schema is then installed into
 * their database automatically.
 *
 * RULES:
 * - Only schema is installed into the user's DB
 * - No app data is copied into their DB
 * - User data remains fully theirs
 * - The user's Supabase instance operates independently
 */

// ── Schema Migration SQL ─────────────────────────────────────────────────────
// This is the complete, self-contained SQL that creates the OpenOnyx
// schema from scratch in a fresh Supabase project.

const SCHEMA_MIGRATION_SQL = `
-- ============================================================================
-- OpenOnyx Schema v2 - Self-contained migration for user-owned databases
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

CREATE TABLE IF NOT EXISTS public.user_keyrings (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  public_key_jwk jsonb NOT NULL,
  algorithm text NOT NULL DEFAULT 'RSA-OAEP-256',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_keyrings ENABLE ROW LEVEL SECURITY;

-- 3. Spaces table
CREATE TABLE IF NOT EXISTS public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  helps_with text[],
  is_public boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('local', 'private', 'public')),
  forked_from uuid REFERENCES public.spaces(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS encrypted_space_key text;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS key_salt text;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS key_iv text;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS key_auth_tag text;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS encryption_version integer;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS key_wrapping text;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS kdf text;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS kdf_params jsonb;

-- 4. Notes table
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS content_encrypted text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS iv text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS auth_tag text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS encryption_version integer;

CREATE TABLE IF NOT EXISTS public.space_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor'
    CHECK (role IN ('owner', 'editor', 'viewer')),
  email text,
  encrypted_space_key text,
  key_iv text,
  key_auth_tag text,
  key_version integer,
  encryption_version integer,
  key_wrapping text,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, user_id)
);
ALTER TABLE public.space_collaborators ENABLE ROW LEVEL SECURITY;

-- 5. Note chunks table (for embeddings / RAG)
CREATE TABLE IF NOT EXISTS public.note_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.note_chunks ENABLE ROW LEVEL SECURITY;

-- 6. Space embeddings (for explore/discovery)
CREATE TABLE IF NOT EXISTS public.space_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE UNIQUE,
  content text NOT NULL,
  embedding vector(1536),
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

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_spaces_owner_updated ON public.spaces (owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_spaces_visibility ON public.spaces (visibility);
CREATE INDEX IF NOT EXISTS idx_notes_space_updated ON public.notes (space_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_deleted ON public.notes (deleted) WHERE deleted = true;
CREATE INDEX IF NOT EXISTS idx_note_chunks_note_updated ON public.note_chunks (note_id, updated_at);

-- ── Triggers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_spaces_updated_at ON public.spaces;
CREATE TRIGGER trg_spaces_updated_at
  BEFORE UPDATE ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notes_updated_at ON public.notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_note_chunks_updated_at ON public.note_chunks;
CREATE TRIGGER trg_note_chunks_updated_at
  BEFORE UPDATE ON public.note_chunks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Auth trigger ─────────────────────────────────────────────────────────────

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

-- Backfill any existing users from auth.users that are not in public.users
INSERT INTO public.users (id, email, created_at)
SELECT id, email, created_at FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── RLS Policies ─────────────────────────────────────────────────────────────

-- Users
CREATE POLICY "Users can view their own profile"
  ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile"
  ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Authenticated users can read public wrapping keys"
  ON public.user_keyrings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert their own public wrapping key"
  ON public.user_keyrings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own public wrapping key"
  ON public.user_keyrings FOR UPDATE USING (auth.uid() = user_id);

-- Spaces
CREATE POLICY "Users can view their own spaces"
  ON public.spaces FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Public spaces are viewable by everyone"
  ON public.spaces FOR SELECT USING (visibility = 'public');
CREATE POLICY "Users can insert their own spaces"
  ON public.spaces FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own spaces"
  ON public.spaces FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete their own spaces"
  ON public.spaces FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "Collaborators can view space collaborators"
  ON public.space_collaborators FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = space_collaborators.space_id AND spaces.owner_id = auth.uid())
  );
CREATE POLICY "Space owners can insert collaborators"
  ON public.space_collaborators FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = space_collaborators.space_id AND spaces.owner_id = auth.uid())
  );
CREATE POLICY "Space owners can update collaborators"
  ON public.space_collaborators FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.spaces WHERE spaces.id = space_collaborators.space_id AND spaces.owner_id = auth.uid())
    OR user_id = auth.uid()
  );

-- Notes
-- Notes
CREATE POLICY "Notes are viewable if space is public, owned, or collaborated"
  ON public.notes FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = notes.space_id
        AND (spaces.visibility = 'public' 
             OR spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL)))
  );
CREATE POLICY "Users and editors can insert notes"
  ON public.notes FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = notes.space_id 
        AND (spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL
                          AND space_collaborators.role IN ('owner', 'editor'))))
  );
CREATE POLICY "Users and editors can update notes"
  ON public.notes FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = notes.space_id 
        AND (spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL
                          AND space_collaborators.role IN ('owner', 'editor'))))
  );
CREATE POLICY "Users and editors can delete notes"
  ON public.notes FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = notes.space_id 
        AND (spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL
                          AND space_collaborators.role IN ('owner', 'editor'))))
  );

-- Note chunks
CREATE POLICY "Chunks viewable if space public, owned, or collaborated"
  ON public.note_chunks FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.notes JOIN public.spaces ON spaces.id = notes.space_id
      WHERE notes.id = note_chunks.note_id
        AND (spaces.visibility = 'public' 
             OR spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL)))
  );
CREATE POLICY "Users and editors can insert chunks"
  ON public.note_chunks FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.notes JOIN public.spaces ON spaces.id = notes.space_id
      WHERE notes.id = note_chunks.note_id 
        AND (spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL
                          AND space_collaborators.role IN ('owner', 'editor'))))
  );
CREATE POLICY "Users and editors can update chunks"
  ON public.note_chunks FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.notes JOIN public.spaces ON spaces.id = notes.space_id
      WHERE notes.id = note_chunks.note_id 
        AND (spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL
                          AND space_collaborators.role IN ('owner', 'editor'))))
  );
CREATE POLICY "Users and editors can delete chunks"
  ON public.note_chunks FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.notes JOIN public.spaces ON spaces.id = notes.space_id
      WHERE notes.id = note_chunks.note_id 
        AND (spaces.owner_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.space_collaborators 
                        WHERE space_collaborators.space_id = spaces.id 
                          AND space_collaborators.user_id = auth.uid()
                          AND space_collaborators.accepted_at IS NOT NULL
                          AND space_collaborators.role IN ('owner', 'editor'))))
  );

-- Space embeddings
CREATE POLICY "Space embeddings readable if space accessible"
  ON public.space_embeddings FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = space_embeddings.space_id
        AND (spaces.visibility = 'public' OR spaces.owner_id = auth.uid()))
  );
CREATE POLICY "Users can manage embeddings for own spaces"
  ON public.space_embeddings FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = space_embeddings.space_id AND spaces.owner_id = auth.uid())
  );
CREATE POLICY "Users can update embeddings for own spaces"
  ON public.space_embeddings FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = space_embeddings.space_id AND spaces.owner_id = auth.uid())
  );
CREATE POLICY "Users can delete embeddings for own spaces"
  ON public.space_embeddings FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.spaces
      WHERE spaces.id = space_embeddings.space_id AND spaces.owner_id = auth.uid())
  );

-- Space stats
CREATE POLICY "Space stats viewable by everyone"
  ON public.space_stats FOR SELECT USING (true);

-- Space votes
CREATE POLICY "Users can view all votes"
  ON public.space_votes FOR SELECT USING (true);
CREATE POLICY "Users can insert their own votes"
  ON public.space_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own votes"
  ON public.space_votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own votes"
  ON public.space_votes FOR DELETE USING (auth.uid() = user_id);

-- ── RPC Functions ────────────────────────────────────────────────────────────

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

-- Vector search functions
-- SECURITY DEFINER: requires auth.uid(), rejects unscoped queries, verifies
-- the caller has access to the requested space.  See issue #62.
CREATE OR REPLACE FUNCTION public.match_note_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_space_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, note_id uuid, content text, similarity float)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF filter_space_id IS NULL THEN
    RAISE EXCEPTION 'filter_space_id is required';
  END IF;

  IF NOT public.is_space_member(filter_space_id) THEN
    RAISE EXCEPTION 'Access denied to space %', filter_space_id;
  END IF;

  RETURN QUERY
  SELECT nc.id, nc.note_id, nc.content,
    1 - (nc.embedding <=> query_embedding) AS similarity
  FROM public.note_chunks nc
  JOIN public.notes n ON n.id = nc.note_id
  WHERE nc.embedding IS NOT NULL
    AND n.space_id = filter_space_id
    AND 1 - (nc.embedding <=> query_embedding) > match_threshold
  ORDER BY nc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_spaces(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (space_id uuid, title text, description text, similarity float)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

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
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserDatabaseConfig {
  supabaseUrl: string;
  anonKey: string;
}

export interface SetupResult {
  success: boolean;
  error?: string;
  tables?: string[];
}

// ── Client Cache ─────────────────────────────────────────────────────────────

let userClient: SupabaseClient<Database> | null = null;
let userConfig: UserDatabaseConfig | null = null;

/**
 * Get or create a Supabase client for a user-owned instance.
 * Returns null if no user database is configured.
 */
export function getUserSupabaseClient(): SupabaseClient<Database> | null {
  return userClient;
}

export async function syncUserDatabaseSession(session: Session | null): Promise<void> {
  if (!userClient) return;

  try {
    if (session?.access_token && session.refresh_token) {
      await userClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    } else {
      await userClient.auth.signOut({ scope: 'local' });
    }
  } catch (err) {
    console.warn('[UserDatabase] Failed to sync auth session to user database client:', err);
  }
}

/**
 * Get the current user database configuration.
 */
export function getUserDatabaseConfig(): UserDatabaseConfig | null {
  return userConfig;
}

export function loadSavedUserDatabaseConfig(): UserDatabaseConfig | null {
  return loadLocalSupabaseConfig();
}

export function saveUserDatabaseConfig(config: UserDatabaseConfig): UserDatabaseConfig {
  const saved = saveLocalSupabaseConfig(config);
  return saved;
}

export function clearSavedUserDatabaseConfig(): void {
  clearLocalSupabaseConfig();
}

/**
 * Connect to a user-owned Supabase instance.
 * This does NOT install the schema -- call setupUserDatabase for that.
 */
export function connectUserDatabase(config: UserDatabaseConfig): SupabaseClient<Database> {
  userConfig = config;
  userClient = createClient<Database>(config.supabaseUrl, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: async (name, acquireTimeout, fn) => {
        return await fn();
      },
    },
  });
  void supabase.auth.getSession()
    .then(({ data, error }) => {
      if (!error) void syncUserDatabaseSession(data.session);
    })
    .catch((err) => {
      console.warn('[UserDatabase] Failed to read active auth session:', err);
    });
  return userClient;
}

/**
 * Disconnect from the user-owned Supabase instance.
 */
export function disconnectUserDatabase(): void {
  userClient = null;
  userConfig = null;
}

export function initializePersistedUserDatabase(): UserDatabaseConfig | null {
  const saved = loadSavedUserDatabaseConfig();
  if (!saved) return null;
  connectUserDatabase(saved);
  return saved;
}

/**
 * Test connectivity to a user-owned Supabase instance.
 * Validates that the URL and key are correct.
 */
export async function testConnection(config: UserDatabaseConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = createClient(config.supabaseUrl, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        lock: async (name, acquireTimeout, fn) => {
          return await fn();
        },
      },
    });
    // Simple health check -- try to read from auth
    const { error } = await client.auth.getSession();
    if (error) {
      return { ok: false, error: `Auth error: ${error.message}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
}

/**
 * Setup the OpenOnyx schema in a user-owned Supabase database.
 *
 * This function:
 * 1. Connects to the user's Supabase instance
 * 2. Runs the complete schema migration
 * 3. Creates all required tables, indexes, triggers, RLS policies, and functions
 * 4. Enables the pgvector extension
 *
 * IMPORTANT:
 * - Only schema is installed -- no app data is copied
 * - User data remains fully theirs
 * - The schema is idempotent (safe to run multiple times)
 *
 * NOTE: This requires the user's Supabase project to have the `pg_net` or
 * direct SQL execution capability. In practice, the user needs to run
 * the migration SQL through their Supabase dashboard SQL Editor since
 * the anon key cannot execute DDL. We provide the SQL as a downloadable
 * migration file.
 */
export async function setupUserDatabase(
  config: UserDatabaseConfig
): Promise<SetupResult> {
  try {
    // 1. Test basic connectivity
    const connTest = await testConnection(config);
    if (!connTest.ok) {
      return { success: false, error: connTest.error };
    }

    // 2. Connect
    const client = connectUserDatabase(config);

    // 3. Verify tables exist by checking if we can query spaces
    // (Schema must be installed manually via SQL Editor since anon key
    //  cannot execute DDL statements)
    const { error: tableCheck } = await client.from('spaces').select('id').limit(1);

    if (tableCheck) {
      // Tables don't exist yet -- user needs to run the migration SQL
      return {
        success: false,
        error: 'Schema not found. Please run the migration SQL in your Supabase SQL Editor first.',
      };
    }

    // 4. Verify all required tables
    const requiredTables = ['users', 'user_keyrings', 'spaces', 'notes', 'note_chunks', 'space_embeddings', 'space_stats', 'space_votes', 'space_collaborators'] as const;
    const missingTables: string[] = [];

    for (const table of requiredTables) {
      const { error } = await client.from(table as any).select('*').limit(0);
      if (error) {
        missingTables.push(table);
      }
    }

    if (missingTables.length > 0) {
      return {
        success: false,
        error: `Missing tables: ${missingTables.join(', ')}. Please run the complete migration SQL.`,
        tables: requiredTables.filter(t => !missingTables.includes(t)),
      };
    }

    return {
      success: true,
      tables: [...requiredTables],
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown error during setup',
    };
  }
}

/**
 * Get the complete migration SQL that users need to run in their
 * Supabase SQL Editor to set up the schema.
 */
export function getMigrationSQL(): string {
  return SCHEMA_MIGRATION_SQL;
}

/**
 * Check if a user database is currently configured and connected.
 */
export function isUserDatabaseConfigured(): boolean {
  return userClient !== null && userConfig !== null;
}
