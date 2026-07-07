"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/app");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.push("/app");
          router.refresh();
        } else {
          setInfo("Te enviamos un email para confirmar tu cuenta. Revisá tu bandeja.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo continuar.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 sm:px-5">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
            <WaveIcon />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Audio Transcriber</h1>
        </div>

        <h2 className="text-lg font-semibold text-slate-900">
          {mode === "login" ? "Iniciá sesión" : "Creá tu cuenta"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login" ? "Para transcribir y guardar tus audios." : "Es gratis, en un minuto."}
        </p>

        <button
          onClick={google}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <GoogleIcon /> Continuar con Google
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" /> o con email <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-400"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="mt-3 text-sm text-emerald-600">
            {info}
          </p>
        )}

        <Button onClick={submit} loading={busy} disabled={!email || !password} size="lg" className="mt-4 w-full">
          {mode === "login" ? "Entrar" : "Crear cuenta"}
        </Button>

        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === "login" ? "¿No tenés cuenta?" : "¿Ya tenés cuenta?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError("");
              setInfo("");
            }}
            className="font-semibold text-brand-600 hover:underline"
          >
            {mode === "login" ? "Registrate" : "Iniciá sesión"}
          </button>
        </p>
      </div>
    </main>
  );
}

function WaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      {[8, 14, 20, 14, 10].map((h, i) => (
        <rect key={i} x={4 + i * 4 - 1.5} y={12 - h / 2} width="3" height={h} rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
