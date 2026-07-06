import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Landing() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si ya está logueado, la landing (marketing) no aporta: directo a la app.
  if (user) redirect("/app");

  const href = "/login";
  const cta = "Probar gratis";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <WaveIcon />
          </div>
          <span className="font-bold">Audio Transcriber</span>
        </div>
        <Link href={href} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white">
          {user ? "Mi cuenta" : "Iniciar sesión"}
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-5 pt-16 pb-10 text-center sm:pt-24">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Tus audios, convertidos en <span className="text-indigo-600">texto</span> en segundos.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
          Subí una nota de voz o cualquier audio y obtené la transcripción al instante. Español y
          decenas de idiomas, con IA de última generación.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href={href}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition hover:bg-indigo-700"
          >
            {cta}
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-400">Gratis para empezar · sin tarjeta</p>
      </section>

      <section className="mx-auto grid max-w-4xl gap-4 px-5 pb-20 sm:grid-cols-3">
        <Feature title="Rapidísimo" desc="Transcripción en segundos con Whisper sobre Groq." />
        <Feature title="Multiidioma" desc="Español, inglés y muchos más. Detección automática." />
        <Feature title="Tus notas, ordenadas" desc="Guardá y encontrá tus transcripciones cuando quieras." />
      </section>
    </main>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{desc}</p>
    </div>
  );
}

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      {[8, 14, 20, 14, 10].map((h, i) => (
        <rect key={i} x={4 + i * 4 - 1.5} y={12 - h / 2} width="3" height={h} rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}
