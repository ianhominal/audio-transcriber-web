# Audio Transcriber

Web app to turn audio into text in seconds using **Groq (Whisper)**. Upload a voice note or any
audio file and get the transcription instantly — Spanish and dozens of languages.

Built with **Next.js** + **Supabase**, ready to deploy on **Vercel**.

## Features

- 🎙️ Transcribe audio (mp3, wav, ogg/opus, m4a, mp4, …) with Groq Whisper (`large-v3` / `turbo`).
- 🔒 The Groq API key lives **only on the server** (environment variable) — never in the browser.
- 👤 User accounts (email/password + Google) with Supabase Auth.
- 💾 Transcriptions are saved per user, with Row Level Security (each user sees only their own).
- 📋 Copy / download the result as `.txt`.

## Tech stack

- [Next.js](https://nextjs.org/) (App Router, TypeScript, Tailwind CSS)
- [Supabase](https://supabase.com/) (Auth + Postgres)
- [Groq](https://groq.com/) (Whisper transcription API)

## Getting started

### 1. Install

```bash
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com/).
2. In **SQL Editor**, run the schema in [`supabase/schema.sql`](supabase/schema.sql).
3. In **Project Settings → API**, copy the Project URL and the `anon` key.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
GROQ_API_KEY=gsk_your_key            # https://console.groq.com/keys
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it on [Vercel](https://vercel.com/).
3. Add the environment variables (`GROQ_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`) in **Settings → Environment Variables**.
4. Deploy.

## How it works

```
Browser  →  /api/transcribe  (server, holds the key)  →  Groq  →  text
                     │
                     └─ saves the transcription in Supabase (per user)
```

## Project structure

```
src/
  app/
    page.tsx                 landing
    login/                   sign in / sign up
    app/                     dashboard + transcribe (auth-protected)
    api/transcribe/          server route (Groq + save)
    auth/callback/           OAuth callback
  lib/supabase/              Supabase clients + session middleware
supabase/schema.sql          database schema (tables + RLS)
```

## License

MIT — see [LICENSE](LICENSE).
