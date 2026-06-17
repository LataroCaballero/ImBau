"use client";

// Login page (AUTH-01, D-13) — minimal functional es-AR voseo form island.
//
// Calls authClient.signIn.email; on success the Better Auth handler sets the session cookie
// (nextCookies()) and we navigate to the dashboard. The dashboard RSC then resolves the active
// org server-side. UI is intentionally plain — no design system this phase.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "../../lib/auth-client";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    });
    setPending(false);
    if (signInError) {
      setError(signInError.message ?? "No pudimos iniciar tu sesión.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main>
      <h1>Iniciar sesión</h1>
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
      >
        <label>
          Correo
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            name="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        ¿No tenés cuenta? <Link href="/signup">Registrate</Link>
      </p>
    </main>
  );
}
