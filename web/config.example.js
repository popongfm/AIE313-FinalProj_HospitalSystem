// Copy to web/config.js (git-ignored) and fill in. Only the public anon key belongs here — never service_role or LLM keys.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  // CHAT_FUNCTION: 'chat',   // default 'chat-mcp' (Method C, MCP); 'chat' = Method B (Text-to-SQL)
};
