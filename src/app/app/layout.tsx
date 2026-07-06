import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link href="/app" className="flex items-center gap-2.5 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <WaveIcon />
            </span>
            Audio Transcriber
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/descargar" className="text-sm font-medium text-slate-500 hover:text-indigo-600">
              Descargar app ↓
            </Link>
            <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function WaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      {[8, 14, 20, 14, 10].map((h, i) => (
        <rect key={i} x={4 + i * 4 - 1.5} y={12 - h / 2} width="3" height={h} rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}
