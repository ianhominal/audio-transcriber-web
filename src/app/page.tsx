import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";

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
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <WaveIcon />
          </div>
          <span className="font-bold tracking-tight">Audio Transcriber</span>
        </div>
        <Link href={href} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {user ? "Mi cuenta" : "Iniciar sesión"}
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-4 pt-16 pb-10 text-center sm:px-5 sm:pt-24">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Tus audios, convertidos en <span className="text-brand-600">texto</span> en segundos.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
          Esa nota de voz de dos minutos que no tenés ganas de escuchar: subila y leela en segundos.
          Notas de WhatsApp, reuniones, clases, lo que sea. Español, inglés y más.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href={href} className={buttonClasses({ size: "lg" })}>
            {cta}
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-400">Gratis para empezar · sin tarjeta</p>
      </section>

      <section className="mx-auto grid max-w-4xl gap-4 px-4 pb-20 sm:grid-cols-3 sm:px-5">
        <Feature icon="⚡" title="En segundos" desc="Subís el audio y el texto aparece casi al toque. Nada de esperar." />
        <Feature icon="🌍" title="Varios idiomas" desc="Español, inglés y más, con detección automática si no sabés cuál es." />
        <Feature icon="🗂️" title="Todo en su lugar" desc="Guardás tus transcripciones en proyectos y las encontrás cuando las necesitás." />
      </section>
    </main>
  );
}

function Feature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <span className="text-xl" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-2 font-semibold">{title}</h3>
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
