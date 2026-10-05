# Supabase · live Telegram pings

`functions/notify` sends a Telegram message within seconds when Aslani or Mariami
saves / hides / restores a flat or writes a note, so the other one sees it without
waiting for the next digest.

## Set up (once, ~5 minutes, in the Supabase dashboard)

1. **Edge Functions → Deploy a new function → "Via Editor"**, name it `notify`,
   paste the contents of `functions/notify/index.ts`, deploy.
   Turn **off** "Verify JWT" for this function (the database webhook calls it
   without a user token).
2. **Edge Functions → Secrets** → add
   - `TELEGRAM_BOT_TOKEN` — the bot token (same as the GitHub secret)
   - `TELEGRAM_CHAT_ID` — `5789897870,-5385317462` (your chat and the group; add
     Mariami's `6386864829` if she wants her own copy)
3. **Database → Webhooks → Create a new hook**
   - Name `shortlist-notify`, table `public.shortlist`, events **Insert** and **Update**
   - Type: *Supabase Edge Function* → `notify`, HTTP method POST
   - Timeout 5000 ms. Save.

Test: favorite a flat on the site; the message should arrive in the group within
a few seconds. Compare-set changes and no-op saves are ignored on purpose.
