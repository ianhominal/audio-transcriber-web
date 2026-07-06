import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Transcription = {
  id: string;
  audio_name: string;
  text: string;
  created_at: string;
};

export default async function Dashboard() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transcriptions")
    .select("id, audio_name, text, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const items = (data ?? []) as Transcription[];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mis transcripciones</h1>
        <Link
          href="/app/transcribe"
          className="rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700"
        >
          + Nueva transcripción
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="font-medium text-slate-700">Todavía no transcribiste nada</p>
          <p className="mt-1 text-sm text-slate-500">
            Subí tu primer audio y va a aparecer acá.
          </p>
          <Link
            href="/app/transcribe"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700"
          >
            Transcribir un audio
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((t) => (
            <li key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-semibold text-slate-800">{t.audio_name}</p>
                <span className="shrink-0 text-xs text-slate-400">
                  {new Date(t.created_at).toLocaleString("es-AR")}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{t.text || "(sin texto)"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
