---
name: default-deepseek-api-key
description: Server-default DeepSeek API key via DEEPSEEK_API_KEY env var enables AI features for all users without per-user config
metadata:
  type: project
---

The app now supports a server-default DeepSeek API key through the `DEEPSEEK_API_KEY` environment variable. When set, all users can use AI coaching features (coach notes, plan adjustment, LLM test) without individually configuring an API key in Settings → API Credentials.

**How it works:**
- `src/lib/llm.ts` — `getDefaultLlmConfig()` reads `DEEPSEEK_API_KEY` from env and returns DeepSeek defaults
- `resolveUserLlmConfig()` falls back to the server default when a user has no key
- All LLM-using routes (dashboard notes, plan adjust, llm-test, workers) use `resolveUserLlmConfig()` instead of manually querying the user
- The credentials settings page shows a blue "Server default: DeepSeek" banner when active
- Users can still override with their own key — it takes priority

**Files changed:**
- `src/lib/llm.ts` — Added `getDefaultLlmConfig()`, `hasServerDefaultKey()`, updated `resolveUserLlmConfig()`
- `src/app/settings/credentials/page.tsx` — Shows server default banner, added `hasServerDefault` state
- `src/app/api/settings/llm/route.ts` — Returns `hasServerDefault` in GET response
- `src/app/api/llm-test/route.ts` — Uses `resolveUserLlmConfig()`
- `src/app/api/dashboard/notes/route.ts` — Uses `resolveUserLlmConfig()`
- `src/app/api/dashboard/plan/adjust/route.ts` — Uses `resolveUserLlmConfig()`
- `src/workers/entrypoint.ts` — Applies server default fallback for background worker reviews
