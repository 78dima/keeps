-- Enable necessary extensions
create extension if not exists "pg_cron" with schema "extensions";
-- Расширение uuid-ossp больше не нужно для генерации ID, так как используем gen_random_uuid()
create extension if not exists "uuid-ossp"; 

-- PROFILES (Linked to Auth)
create table profiles (
  id uuid references auth.users(id) on delete cascade not null primary key,
  email text,
  telegram_chat_id text,
  linking_code text,
  updated_at timestamp with time zone default now()
);

alter table profiles enable row level security;

create policy "Users can view their own profile" 
  on profiles for select 
  using (auth.uid() = id);

create policy "Users can update their own profile" 
  on profiles for update 
  using (auth.uid() = id);

-- PUSH SUBSCRIPTIONS (For PWA)
create table push_subscriptions (
  id uuid default gen_random_uuid() primary key, -- ИСПРАВЛЕНО ЗДЕСЬ
  user_id uuid references auth.users(id) not null default auth.uid(),
  
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  
  user_agent text,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "Users can crud their own subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger to create profile on signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

-- Удаляем триггер, если он уже есть, чтобы избежать ошибок при повторном накате
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- NOTES TABLE
create table notes (
  id uuid default gen_random_uuid() primary key, -- ИСПРАВЛЕНО ЗДЕСЬ
  user_id uuid references auth.users(id) not null default auth.uid(),
  
  title text default '',
  content text default '',
  color text,
  
  is_pinned boolean default false,
  is_archived boolean default false,
  is_deleted boolean default false, -- Trash bin
  sync_deleted boolean default false, -- Tombstone for sync
  
  reminder_date timestamp with time zone,
  is_reminder_sent boolean default false,
  
  tags jsonb default '[]'::jsonb, 
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Indexes for performance
create index notes_user_id_idx on notes(user_id);
create index notes_updated_at_idx on notes(updated_at);
create index notes_reminder_idx on notes(reminder_date) where is_reminder_sent = false;

alter table notes enable row level security;

-- RLS Policies for Notes
create policy "Users can crud their own notes"
  on notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- TAGS TABLE
create table tags (
  id uuid default gen_random_uuid() primary key, -- ИСПРАВЛЕНО ЗДЕСЬ
  user_id uuid references auth.users(id) not null default auth.uid(),
  name text not null,
  
  sync_deleted boolean default false,
  updated_at timestamp with time zone default now(),
  
  unique(user_id, name)
);

create index tags_user_id_idx on tags(user_id);
create index tags_updated_at_idx on tags(updated_at);

alter table tags enable row level security;

-- RLS Policies for Tags
create policy "Users can crud their own tags"
  on tags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- UTILITIES
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger update_notes_updated_at
    before update on notes
    for each row
    execute procedure update_updated_at_column();

create trigger update_tags_updated_at
    before update on tags
    for each row
    execute procedure update_updated_at_column();

-- REALTIME: Enable postgres_changes for notes and tags
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.tags;

-- REPLICA IDENTITY: Required for Realtime UPDATE/DELETE events to include full row data
alter table public.notes replica identity full;
alter table public.tags replica identity full;