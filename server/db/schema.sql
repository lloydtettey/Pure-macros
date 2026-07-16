-- Pure Macros — Postgres schema (Supabase)
--
-- Six entities are normalized into their own tables, mirroring the field
-- names they already had in db.json: users, entries, saved_meals,
-- exercise_logs, routines, weight_logs. Everything else a user account
-- carries (settings, water, stepsLogs, sleepLogs, fasting, reminders,
-- devices, savedRecipes, savedFoods, messages, mealPlan, customExercises,
-- currentStreak, lastLoggedDate, onboarded) stays exactly as it was — one
-- JSONB blob per user in user_profiles — since none of it benefits from
-- relational modeling and server.js already treats it as one opaque object.
--
-- Run this once against your Supabase database (SQL Editor, or `psql
-- "$DATABASE_URL" -f server/db/schema.sql`) before running the migration
-- script or booting the server against Postgres.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text,
  salt text,
  hash text,
  google_id text unique,
  apple_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

-- Dates are stored as text ('YYYY-MM-DD'), not the Postgres `date` type — the
-- app already validates that exact format everywhere and compares/sorts
-- dates as strings (e.g. `e.date === date`, `w.date.localeCompare(...)`).
-- Storing `date` typed columns would hand back JS Date objects on read,
-- which shift by a day around UTC/local-timezone conversion and would force
-- every route to reformat them back to strings anyway.

create table if not exists user_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date text not null,
  meal text not null,
  food_id text not null,
  name text not null,
  grams numeric not null,
  calories numeric not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  fiber numeric not null default 0,
  sugar numeric not null default 0,
  saturated_fat numeric not null default 0,
  polyunsaturated_fat numeric not null default 0,
  monounsaturated_fat numeric not null default 0,
  sodium numeric not null default 0,
  cholesterol numeric not null default 0,
  potassium numeric not null default 0,
  iron numeric not null default 0,
  vitamin_a numeric not null default 0,
  vitamin_c numeric not null default 0,
  vitamin_d numeric not null default 0,
  vitamin_b12 numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists entries_user_date_idx on entries(user_id, date);

create table if not exists saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  calories numeric not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists saved_meals_user_idx on saved_meals(user_id);

create table if not exists exercise_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date text not null,
  type text not null,
  name text not null,
  minutes numeric not null,
  calories_burned numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists exercise_logs_user_date_idx on exercise_logs(user_id, date);

create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  exercises jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists routines_user_idx on routines(user_id);

create table if not exists weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date text not null,
  weight numeric not null,
  photo_url text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists weight_logs_user_date_idx on weight_logs(user_id, date);
