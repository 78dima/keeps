# Supabase Setup Guide for MonoKeep

This project uses **Supabase** (PostgreSQL) for the database, authentication, and real-time sync with RxDB.

## 1. Prerequisites

1.  Create a [Supabase Project](https://supabase.com/dashboard).
2.  Install [Supabase CLI](https://supabase.com/docs/guides/cli) (optional, but recommended for edge functions).

## 2. Database Schema

1.  Go to the **SQL Editor** in your Supabase Dashboard.
2.  Copy the content of [supabase/schema.sql](./supabase/schema.sql) from this project.
3.  Run the script. This will:
    -   Enable necessary extensions (`pg_cron`, `uuid-ossp`).
    -   Create `profiles`, `notes`, and `tags` tables.
    -   Set up Row Level Security (RLS) policies.
    -   Create triggers for user profile creation and timestamp updates.

## 3. Environment Variables (Frontend)

Create or update `.env.local` in `apps/web`:

```bash
# Get these from Supabase Dashboard -> Project Settings -> API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# VAPID Keys for Push Notifications (Optional if using Supabase Edge Function for Telegram)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
NEXT_PUBLIC_VAPID_PRIVATE_KEY=...
```

## 4. Authentication

Supabase Auth is pre-configured in the schema.
-   **Email/Password**: Enabled by default.
-   **Telegram**: To use the Telegram features, you need to create a bot and link it.

## 5. Edge Functions (Telegram Reminders)

To send scheduled reminders via Telegram:

1.  **Login to CLI**:
    ```bash
    supabase login
    ```

2.  **Deploy Function**:
    ```bash
    # Run from project root
    supabase functions deploy send-telegram-notifications
    ```

3.  **Set Secrets**:
    You need to set the Telegram Bot Token for the function to work.
    ```bash
    supabase secrets set TELEGRAM_BOT_TOKEN=your-telegram-bot-token
    ```

4.  **Schedule (Cron)**:
    The schema already includes the `pg_cron` extension. You need to schedule the function.
    Run this SQL in your Supabase Dashboard (replace `PROJECT_REF` and `SERVICE_ROLE_KEY`):

    ```sql
    select cron.schedule(
      'send-reminders-every-minute',
      '* * * * *',
      $$
        select
          net.http_post(
              url:='https://PROJECT_REF.supabase.co/functions/v1/send-telegram-notifications',
              headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
          ) as request_id;
      $$
    );
    ```

## 6. Verification

1.  Start the frontend: `npm run dev` in `apps/web`.
2.  Be sure to register a new user (legacy users won't work as they are not in `auth.users`).
3.  Check the browser console/network tab to confirm `replication.ts` is successfully pulling/pushing to Supabase without 401 errors.
