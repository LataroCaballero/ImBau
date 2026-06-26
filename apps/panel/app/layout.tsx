import type { ReactNode } from "react";

// Minimal root layout (D-09); es-AR from day one.
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
