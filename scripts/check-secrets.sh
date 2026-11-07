#!/usr/bin/env bash
# Fails if a tracked file contains something that looks like a JWT, Groq or OpenAI-style key.
cd "$(dirname "$0")/.."
if git grep -nE 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9]+' -- . ':!scripts/write-config.test.mjs' ':!scripts/check-secrets.sh'; then
  echo "SECRET-LIKE STRING FOUND"; exit 1
fi
echo "no secrets found in tracked files"
