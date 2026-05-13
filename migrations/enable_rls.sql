-- Enable Row-Level Security on all tables
-- The backend connects via direct PostgreSQL URL (bypasses RLS), so no policies are needed.
-- This blocks public access through Supabase's REST API (anon/authenticated roles).

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_entries ENABLE ROW LEVEL SECURITY;
