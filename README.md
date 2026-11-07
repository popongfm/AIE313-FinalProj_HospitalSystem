# AIE313 Hospital Information System + AI Chat

Supabase (PostgreSQL + Auth + Edge Function) · static HTML/JS web app (Vercel) · Text-to-SQL chat limited to 9 read-only views.
Plan: `docs/superpowers/plans/` · ER diagrams: `docs/er/` · test cases: `docs/test-cases.md` · queries: `analysis/analysis_queries.sql`

## Deploy checklist (one time)
1. **Supabase project** → SQL editor: run `schema.sql`, then `seed.sql` (21→22 tables, 9 views, RLS, `chat_reader` role, `run_readonly_query`).
   If an older `schema.sql` was run before (it stopped at `ALTER FUNCTION ... OWNER TO chat_reader`, or left `run_readonly_query` owned by `postgres`), start from an empty project or run `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;` first.
2. Auth → **disable "Allow new users to sign up"**, then create users by hand (Auth → Users). Link each user to a profile as an admin, otherwise RLS shows them nothing:
   `INSERT INTO profiles(user_id, role) VALUES ('<auth user uuid>', 'admin');`
   **Required:** `ALTER ROLE service_role SET statement_timeout = '10s';` (query timeout for the chat function).
3. **Edge Functions** (needs Supabase CLI). Default chat = **MCP (Method C)** `chat-mcp`; `chat` (Text-to-SQL, Method B) is kept as an alternative (set `CHAT_FUNCTION=chat` in Vercel to use it):
   `supabase functions deploy chat-mcp --project-ref <ref>` (and optionally `chat`) then
   `supabase secrets set GROQ_API_KEY=<key> LLM_MODEL=llama-3.3-70b-versatile --project-ref <ref>`
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.) Confirm the model name is current at https://console.groq.com/docs/models.
4. **Vercel**: import the GitHub repo, set env `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the *anon/publishable* key only). `vercel.json` runs `scripts/write-config.mjs`, which refuses service_role keys.
5. Re-run the manual cases marked *todo* in `docs/test-cases.md` on the deployed URL (ask the same chat questions with the real LLM).

## Local development & tests
- Never commit keys: `bash scripts/check-secrets.sh`
- Web: copy `web/config.example.js` → `web/config.js` (git-ignored); `python3 -m http.server -d web 8080`
- SQL tests (local Postgres ≥15 or docker): `PGHOST=… PGPORT=… PGUSER=… bash db/tests/run_tests.sh`
- Build deliverables: `bash db/build_schema.sh` → `schema.sql`, `seed.sql`; regenerate seed: `python3 db/seed/generate_seed.py --seed 313 > db/seed/seed.sql`
- Web unit tests: `node --test web/tests/*.test.mjs scripts/*.test.mjs` · browser smoke test (mocked Supabase): `PLAYWRIGHT_PATH=<playwright> node web/tests/smoke.mjs`
- MCP chat: `cd supabase/functions/chat-mcp && deno test --allow-env` · cases against a DB: `deno run --allow-run --allow-env cases.ts <db>` · regenerate the view catalog after changing views: `python3 gen_view_catalog.py <db> > viewCatalog.ts`
- Text-to-SQL chat function: `deno test --allow-env supabase/functions/chat/` · regenerate the prompt after changing views: `python3 supabase/functions/chat/gen_schema_prompt.py <db> > supabase/functions/chat/schemaPrompt.ts`
- ER diagrams: `python3 docs/er/gen_er.py <db> docs/er` then `mmdc -i docs/er/er_full.mmd -o docs/er/er_full.png -s 2 -w 2200`

## Environment variables
| Where | Name | Notes |
|---|---|---|
| Web (public) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | in git-ignored `web/config.js` |
| Edge Function secret | `GROQ_API_KEY`, `LLM_MODEL` (optional), `LLM_BASE_URL` (optional) | never in git or the browser |
