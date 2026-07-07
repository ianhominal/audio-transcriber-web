import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Página pública de descarga del cliente desktop (sincronizador).
 * Es pública (cualquiera la ve), pero el header refleja si ya hay sesión.
 */
export default async function DescargarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <WaveIcon />
          </div>
          <span className="font-bold">Audio Transcriber</span>
        </Link>
        <Link
          href={user ? "/app" : "/login"}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white"
        >
          {user ? "Ir a la app" : "Iniciar sesión"}
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-5 pt-16 pb-10 text-center sm:pt-24">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Sincronizador de <span className="text-indigo-600">escritorio</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
          Sincronizá una carpeta de tu PC con tus proyectos en la nube, como Dropbox pero para tus
          transcripciones. Editá desde la web o desde tu compu y todo queda al día automáticamente.
        </p>

        <div className="mt-10">
          <a
            href="https://github.com/ianhominal/audio-transcriber-web/releases/download/desktop-v1.0.0/AudioTranscriber-win-Setup.exe"
            className="inline-block rounded-lg bg-indigo-600 px-8 py-4 text-lg font-semibold text-white transition hover:bg-indigo-700"
          >
            ⬇ Descargar para Windows
          </a>
          <p className="mt-3 text-sm text-slate-400">Windows 10/11 · 64 bits · se actualiza sola</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-4xl gap-4 px-5 pb-20 sm:grid-cols-3">
        <Feature
          title="Sincronización automática"
          desc="Elegí una carpeta local y se mantiene al día con tu cuenta en la nube."
        />
        <Feature
          title="Funciona sin conexión"
          desc="Trabajá offline; los cambios se suben apenas volvés a tener internet."
        />
        <Feature title="Requisitos" desc="Windows 10/11 de 64 bits. Instalación en segundos." />
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
