import type { ReactNode } from "react";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Root layout for the panel (10-UI-SPEC §Wiring). This milestone's FIRST styled
// surface: the panel now wears the ImBau brand tokens. The three brand faces are
// self-hosted at build via next/font/google (no runtime font fetch, no FOUT,
// size-adjust prevents layout shift). Each font exposes a CSS variable that
// app/globals.css `@theme` forwards to --font-display / --font-text / --font-mono,
// so Tailwind font utilities resolve them.
//
// Space Grotesk = display (H1 only), Inter = UI text, JetBrains Mono = figures
// (money renders in tabular mono — the non-negotiable money rendering rule).
//
// The panel is a light-surface data tool (brand-book): bg-hormigon canvas,
// grafito primary text, Inter body. es-AR from day one.
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
      <body className="bg-hormigon text-grafito font-text">{children}</body>
    </html>
  );
}
