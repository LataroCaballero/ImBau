// notFound() boundary for the project shell (D-07) — the uniform es-AR 404.
//
// Rendered whenever a layout or tab page calls notFound(): a malformed id, a cross-org id, or a
// non-existent id ALL land here with the SAME copy (no-enumeration — a deep-linker cannot tell a
// project that exists-but-isn't-theirs from one that never existed). es-AR voseo, no design system.
import Link from "next/link";

export default function ProjectNotFound(): React.JSX.Element {
  return (
    <main>
      <h1>No encontramos ese proyecto.</h1>
      <p>Puede que no exista o que no tengas acceso.</p>
      <Link href="/">Volver a tus proyectos</Link>
    </main>
  );
}
