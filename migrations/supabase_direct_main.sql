-- IDG Training Pro - direct Supabase mode for the main app.
-- Run this in Supabase SQL before publishing the frontend branch.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE gym_sessions ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE gym_templates ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE weight_records ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE sleep_records ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE weekly_plan ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE intelligence_entries ADD COLUMN IF NOT EXISTS owner_id UUID;

UPDATE user_profiles p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE gym_sessions p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE gym_templates p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE activities p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE weight_records p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE sleep_records p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE goals p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE weekly_plan p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);
UPDATE intelligence_entries p SET owner_id = u.id FROM auth.users u WHERE p.owner_id IS NULL AND lower(p.user_id) = lower(u.email);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_owner_unique_idx ON user_profiles (owner_id);
CREATE INDEX IF NOT EXISTS gym_sessions_owner_date_idx ON gym_sessions (owner_id, session_date DESC);
CREATE INDEX IF NOT EXISTS gym_templates_owner_updated_idx ON gym_templates (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS activities_owner_sport_date_idx ON activities (owner_id, sport, activity_date DESC);
CREATE INDEX IF NOT EXISTS weight_records_owner_date_idx ON weight_records (owner_id, record_date DESC);
CREATE INDEX IF NOT EXISTS sleep_records_owner_date_idx ON sleep_records (owner_id, record_date DESC);
CREATE INDEX IF NOT EXISTS goals_owner_date_idx ON goals (owner_id, goal_date DESC);
CREATE INDEX IF NOT EXISTS intelligence_entries_owner_type_idx ON intelligence_entries (owner_id, entry_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS planned_sessions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_id UUID,
  session_date DATE,
  type TEXT NOT NULL DEFAULT 'gym',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS planned_sessions_owner_date_idx ON planned_sessions (owner_id, session_date ASC, type ASC);

INSERT INTO planned_sessions (id, user_id, owner_id, session_date, type, data, updated_at)
SELECT
  COALESCE(item->>'id', gen_random_uuid()::text),
  wp.user_id,
  wp.owner_id,
  NULLIF(item->>'date', '')::date,
  COALESCE(item->>'type', 'gym'),
  item,
  wp.updated_at
FROM weekly_plan wp
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(wp.data) = 'array' THEN wp.data ELSE '[]'::jsonb END) AS item
ON CONFLICT (user_id, id) DO UPDATE
SET owner_id = EXCLUDED.owner_id,
    session_date = EXCLUDED.session_date,
    type = EXCLUDED.type,
    data = EXCLUDED.data,
    updated_at = EXCLUDED.updated_at;

CREATE TABLE IF NOT EXISTS gym_exercises (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_id UUID,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  sets_planned INTEGER NOT NULL DEFAULT 0,
  reps TEXT,
  rest_seconds INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id, id)
);

CREATE TABLE IF NOT EXISTS gym_sets (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_id UUID,
  set_number INTEGER NOT NULL,
  reps TEXT,
  weight NUMERIC,
  completed BOOLEAN NOT NULL DEFAULT false,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id, exercise_id, set_number)
);

CREATE INDEX IF NOT EXISTS gym_exercises_owner_session_idx ON gym_exercises (owner_id, session_id, position);
CREATE INDEX IF NOT EXISTS gym_sets_owner_session_idx ON gym_sets (owner_id, session_id, exercise_id, set_number);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_sets ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_profiles',
    'gym_sessions',
    'gym_templates',
    'activities',
    'weight_records',
    'sleep_records',
    'goals',
    'weekly_plan',
    'intelligence_entries',
    'planned_sessions',
    'gym_exercises',
    'gym_sets'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_owner_select', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_owner_insert', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_owner_update', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_owner_delete', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (owner_id = auth.uid())', table_name || '_owner_select', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (owner_id = auth.uid())', table_name || '_owner_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())', table_name || '_owner_update', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (owner_id = auth.uid())', table_name || '_owner_delete', table_name);
  END LOOP;
END $$;
