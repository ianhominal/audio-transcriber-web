<div align="center">

# 🎙️ Audio Transcriber

### Turn any audio into text in seconds — powered by AI.

Drop a voice note or any audio file and get an accurate transcription instantly.
Spanish and dozens of languages, with a clean and fast experience.

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**Live demo — _coming soon_ (deploying to Vercel)**

</div>

---

## ✨ Why you'll like it

- ⚡ **Instant** — transcriptions in seconds, not minutes, thanks to Groq's Whisper inference.
- 🌎 **Any language** — Spanish, English and dozens more, with automatic detection.
- 🎧 **Any format** — mp3, wav, ogg/opus (WhatsApp voice notes!), m4a, mp4 and more.
- 👤 **Your library** — sign in and every transcription is saved, ready when you need it.
- ✍️ **Editable** — tweak the text, then copy it or download it as `.txt`.

## 🛠️ Built with

| Layer | Tech |
|-------|------|
| Framework | **Next.js** (App Router) + **TypeScript** |
| Styling | **Tailwind CSS** |
| Auth & Data | **Supabase** (Auth + Postgres) |
| Transcription | **Groq** — Whisper `large-v3` / `turbo` |
| Hosting | **Vercel** |

## 🧠 Engineering highlights

Small app, real-world architecture:

- **Server-side API proxy** — third-party calls run on the backend, keeping the client clean.
- **Row-Level Security** — every user can only ever read their own data, enforced at the database.
- **Type-safe end to end** — TypeScript across UI, server routes and data access.
- **Auth done right** — email/password and Google OAuth via Supabase, with protected routes middleware.

## 🚀 Run it locally

```bash
git clone https://github.com/ianhominal/audio-transcriber-web.git
cd audio-transcriber-web
npm install
```

1. Create a free project at [supabase.com](https://supabase.com/), then apply the database schema:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
   The schema lives as versioned migrations in [`supabase/migrations/`](supabase/migrations/).
2. Copy `.env.example` → `.env.local` and fill in your Supabase keys and a [Groq API key](https://console.groq.com/keys).
3. Start it:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and transcribe your first audio.

## 📁 Structure

```
src/
  app/          landing · login · dashboard · transcribe · API route
  lib/supabase/ Supabase clients + session middleware
supabase/       database schema (tables + RLS)
```

## 📄 License

MIT © [Ian Hominal](https://github.com/ianhominal)

<div align="center">
<sub>Built with care — feedback and stars are always welcome ⭐</sub>
</div>
