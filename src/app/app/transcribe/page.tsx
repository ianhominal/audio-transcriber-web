"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";

const SUPPORTED = [".mp3", ".wav", ".ogg", ".opus", ".m4a", ".mp4", ".flac", ".webm"];

export default function TranscribePage() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("es");
  const [model, setModel] = useState("whisper-large-v3-turbo");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    setError("");
    setText("");
    setSaved(false);
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  }, []);

  const transcribe = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setText("");
    setSaved(false);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);
      form.append("model", model);
      const resp = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "No se pudo transcribir.");
      setText(data.text || "(sin texto)");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  };

  const copy = () => navigator.clipboard.writeText(text);
  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (file?.name.replace(/\.[^.]+$/, "") || "transcripcion") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const prettySize = file ? (file.size / 1024 / 1024).toFixed(1) + " MB" : "";

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nueva transcripción</h1>
        <Link href="/app" className="text-sm font-medium text-slate-500 hover:text-indigo-600">
          ← Volver
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
            dragOver ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:bg-slate-50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={SUPPORTED.join(",")}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div>
              <p className="font-medium text-slate-800">{file.name}</p>
              <p className="text-sm text-slate-500">{prettySize} · clic para cambiar</p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-slate-700">Arrastrá tu audio acá</p>
              <p className="mt-1 text-sm text-slate-500">o hacé clic para elegirlo · mp3, wav, ogg, m4a…</p>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-semibold text-slate-500">Idioma</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="es">Español</option>
              <option value="auto">Automático</option>
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-semibold text-slate-500">Calidad</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="whisper-large-v3-turbo">Rápida (turbo)</option>
              <option value="whisper-large-v3">Máxima (large-v3)</option>
            </select>
          </label>
          <button
            onClick={transcribe}
            disabled={!file || busy}
            className="ml-auto rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-300"
          >
            {busy ? "Transcribiendo…" : "Transcribir"}
          </button>
        </div>

        {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {text && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">
                Transcripción {saved && <span className="ml-2 text-sm font-normal text-emerald-600">✓ guardada</span>}
              </h2>
              <div className="flex gap-2">
                <button onClick={copy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Copiar</button>
                <button onClick={download} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">Descargar .txt</button>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-56 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-[15px] leading-relaxed outline-none focus:border-indigo-400"
            />
          </div>
        )}
      </div>
    </div>
  );
}
