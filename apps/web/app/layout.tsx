import type { ReactNode } from "react";

// Minimal root layout (D-09): no branding/design system yet — that lands in
// later phases. The `lang="es-AR"` attribute applies the language convention
// from day one (CLAUDE.md: UI en es-AR voseo).
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
