-- Migration: chat history is complete (bonus "บันทึกประวัติ Chat ลงตาราง chat_logs"). Safe to run again.
--   * answer: what the assistant answered (or the error message the user saw)
--   * user_id becomes a foreign key to auth.users (ON DELETE SET NULL: history stays when an account is deleted)
-- Run in the SQL editor, then deploy the chat-mcp and chat Edge Functions of the same version (they fill answer).
BEGIN;
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS answer TEXT;
-- rows of accounts that no longer exist would block the foreign key: keep the rows, drop the dangling link
UPDATE chat_logs c SET user_id = NULL WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chat_logs'::regclass AND contype = 'f') THEN
    ALTER TABLE chat_logs ADD CONSTRAINT chat_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;
COMMIT;
