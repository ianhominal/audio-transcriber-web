import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/icon";
import { InstallPrompt } from "@/components/install-prompt";
import LogoutButton from "./logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <ToastProvider>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/app" className="flex items-center gap-2.5 font-bold tracking-tight">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                <WaveIcon />
              </span>
              <span>Audio Transcriber</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-1 sm:gap-2" aria-label="Cuenta">
              <Link
                href="/app/brain"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:bg-surface-secondary hover:text-accent"
              >
                <Icon name="chat" className="shrink-0" title="Chat con IA" />
                <span className="hidden sm:inline">Chat con IA</span>
              </Link>
              <Link
                href="/descargar"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:bg-surface-secondary hover:text-accent"
              >
                <Icon name="download" className="shrink-0 sm:hidden" title="Descargar app" />
                <span className="hidden sm:inline">Descargar app</span>
                <Icon name="download" size={14} className="hidden shrink-0 sm:inline" />
              </Link>
              <Link
                href="/app/ajustes"
                className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-tertiary transition-colors duration-150 ease-out hover:bg-surface-secondary hover:text-accent"
              >
                Ajustes
              </Link>
              <span className="hidden truncate text-sm text-tertiary md:inline md:max-w-[12rem]" title={user.email}>
                {user.email}
              </span>
              <LogoutButton />
            </nav>
          </div>
        </header>
        {children}
      </div>
      <InstallPrompt />
    </ToastProvider>
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
