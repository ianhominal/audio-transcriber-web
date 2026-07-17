import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Serif de lectura para la vista "Leer" de una transcripción (ver `TranscriptReader`): un documento
// largo se lee mejor en serif con ancho de lectura acotado que en el sans de la interfaz. Solo se
// usa ahí — el resto de la app sigue en Geist. `italic` disponible para énfasis dentro del texto.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Audio Transcriber — audio a texto en segundos",
  description: "Transcribí tus audios (español y más) a texto en segundos. Rápido y simple.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Transcriber",
  },
};

// `themeColor` es metadata estática (resuelta en build/request), no reactiva al tema
// elegido por el usuario en el cliente — Next no ofrece una forma SSR-safe de leer el
// tema de next-themes acá. Se deja el brand-600 actual; la barra de estado del navegador
// no cambia entre light/dark (no rompe nada, solo no es "perfecta").
export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
