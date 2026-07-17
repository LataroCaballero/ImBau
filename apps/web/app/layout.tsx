import type { ReactNode } from "react";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Root layout for the public showroom. The three ImBau brand faces are
// self-hosted at build via next/font/google (RESEARCH Pattern 7, D-13): no
// runtime network font fetch, no FOUT, and `size-adjust` prevents
// layout shift — all of which the <3s-4G budget depends on. Each font exposes a
// CSS variable that app/globals.css `@theme` forwards to --font-display /
// --font-text / --font-mono, so Tailwind font utilities resolve them.
//
// Space Grotesk = display (headings), Inter = UI text, JetBrains Mono = figures
// (UI-06: deterministic es-AR money formatting renders in tabular mono).
//
// The tRPC client provider is intentionally NOT mounted here — the cotizador
// page mounts TRPCReactProvider around its own interactive island (mirroring the
// panel), keeping the layout a pure Server Component.
const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const text = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <html
      lang="es-AR"
      className={`${display.variable} ${text.variable} ${mono.variable}`}
    >
      <body className="bg-grafito text-hormigon font-text">{children}</body>
    </html>
  );
}
