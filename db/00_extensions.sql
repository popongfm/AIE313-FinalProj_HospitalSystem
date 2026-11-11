-- No extra extensions required (gen_random_uuid is built in on PG13+).

-- Thailand time: Asia/Bangkok (GMT+7, no daylight saving) for every new connection, so now(), CURRENT_DATE and the
-- timestamptz values the API returns are Thai time (Supabase starts in UTC). Also this session, for the rest of the file.
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Bangkok'); END $$;
SET timezone TO 'Asia/Bangkok';
