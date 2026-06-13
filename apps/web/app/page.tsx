import { AppStatus } from "@imbau/ui";
import { env } from "../env";

// Status page (D-09), es-AR voseo. Server Component reading the VALIDATED `env`
// (never process.env directly). Consumes @imbau/ui to exercise the app → ui edge
// (D-12). Smoke target for future deploys: confirms the app booted with its env
// validated.
export default function StatusPage(): React.JSX.Element {
  return (
    <main>
      <h1>ImBau · Web</h1>
      <p>
        <AppStatus label="Estado: en línea" />
      </p>
      <p>Entorno: {env.NEXT_PUBLIC_APP_ENV}</p>
      <p>El entorno se validó correctamente al iniciar.</p>
    </main>
  );
}
