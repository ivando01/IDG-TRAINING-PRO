CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  picture TEXT,
  strava_id TEXT,
  strava_access_token TEXT,
  strava_refresh_token TEXT,
  strava_expires_at BIGINT,
  plan TEXT NOT NULL DEFAULT 'free',
  coach_access BOOLEAN NOT NULL DEFAULT false,
  full_access_until TIMESTAMPTZ,
  is_founder BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_expires_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_access BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_access_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_founder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gym_sessions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  data JSONB NOT NULL,
  session_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS gym_templates (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('running', 'cycling')),
  source TEXT,
  external_id TEXT,
  type TEXT,
  name TEXT,
  date TIMESTAMPTZ,
  distance_km NUMERIC,
  duration_min NUMERIC,
  elapsed_min NUMERIC,
  elevation_m NUMERIC,
  avg_speed_kmh NUMERIC,
  max_speed_kmh NUMERIC,
  avg_hr NUMERIC,
  max_hr NUMERIC,
  calories NUMERIC,
  raw_data JSONB,
  activity_date DATE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE activities ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS distance_km NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS duration_min NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS elapsed_min NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS elevation_m NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS avg_speed_kmh NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_speed_kmh NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS avg_hr NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_hr NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS calories NUMERIC;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS raw_data JSONB;

UPDATE activities
SET source='strava',
    external_id=regexp_replace(id, '^strava-', '')
WHERE lower(source)='strava'
  AND external_id IS NULL
  AND id LIKE 'strava-%';

CREATE INDEX IF NOT EXISTS idx_activities_user_sport_date
  ON activities (user_id, sport, activity_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS activities_unique_source
  ON activities (user_id, source, external_id);

CREATE TABLE IF NOT EXISTS weight_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  record_date DATE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS sleep_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  record_date DATE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_sleep_user_date
  ON sleep_records (user_id, record_date DESC);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  goal_date DATE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_goals_user_date
  ON goals (user_id, goal_date DESC);

CREATE TABLE IF NOT EXISTS weekly_plan (
  user_id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intelligence_entries (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'global',
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_user_type
  ON intelligence_entries (user_id, entry_type, updated_at DESC);
