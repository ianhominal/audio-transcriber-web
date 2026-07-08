import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonClasses } from "@/components/ui/Button";

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
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <WaveIcon />
          </div>
          <span className="font-bold tracking-tight">Audio Transcriber</span>
        </Link>
        <Link href={user ? "/app" : "/login"} className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {user ? "Ir a la app" : "Iniciar sesión"}
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-4 pt-16 pb-10 text-center sm:px-5 sm:pt-24">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Sincronizador de <span className="text-brand-600">escritorio</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
          Sincronizá una carpeta de tu PC con tus proyectos en la nube, como Dropbox pero para tus
          transcripciones. Editá desde la web o desde tu compu y todo queda al día automáticamente.
        </p>

        <div className="mt-10">
          <a
            href="https://github.com/ianhominal/audio-transcriber-web/releases/latest/download/AudioTranscriber-win-Setup.exe"
            className={buttonClasses({ size: "lg", className: "text-lg" })}
          >
            ⬇ Descargar para Windows
          </a>
          <p className="mt-3 text-sm text-slate-500">Windows 10/11 · 64 bits · se actualiza sola</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-4xl gap-4 px-4 pb-20 sm:grid-cols-3 sm:px-5">
        <Feature
          icon="🔄"
          title="Sincronización automática"
          desc="Elegí una carpeta local y se mantiene al día con tu cuenta en la nube."
        />
        <Feature
          icon="📡"
          title="Funciona sin conexión"
          desc="Trabajá offline; los cambios se suben apenas volvés a tener internet."
        />
        <Feature icon="🖥️" title="Requisitos" desc="Windows 10/11 de 64 bits. Instalación en segundos." />
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
