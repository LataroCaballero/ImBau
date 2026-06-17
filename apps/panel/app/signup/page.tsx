"use client";

// Signup page (AUTH-01 / Pitfall 2, D-13) — minimal es-AR voseo form island.
//
// Better Auth does NOT auto-create or auto-activate an organization on signup, and
// protectedProcedure (and thus the dashboard read) requires session.activeOrganizationId. So a
// fresh signup here: (1) creates the user + session via signUp.email, (2) creates the user's
// first organization (the creator resolves to "owner" — creatorRole default), and (3) sets it
// active via organization.setActive. That closes the null-active-org gap so the dashboard does
// not 401 right after registering. Invitees use /accept-invitation/[id] instead (the accepted
// org becomes active there).
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "../../lib/auth-client";

// A slug derived from the org name; Better Auth requires a unique slug per organization.
function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  // Append a short random suffix so two orgs with the same name never collide.
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "org"}-${suffix}`;
}

export default function SignupPage(): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    if (signUpError) {
      setPending(false);
      setError(signUpError.message ?? "No pudimos crear tu cuenta.");
      return;
    }

    // Create the first organization and make it the active tenant (Pitfall 2).
    const { data: org, error: orgError } =
      await authClient.organization.create({
        name: orgName,
        slug: slugify(orgName),
      });
    if (orgError || !org) {
      setPending(false);
      setError(orgError?.message ?? "No pudimos crear tu organización.");
      return;
    }

    const { error: activeError } = await authClient.organization.setActive({
      organizationId: org.id,
    });
    setPending(false);
    if (activeError) {
      setError(
        activeError.message ?? "No pudimos activar tu organización.",
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main>
      <h1>Crear cuenta</h1>
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
      >
        <label>
          Nombre
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Nombre de tu organización
          <input
            name="orgName"
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear cuenta"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        ¿Ya tenés cuenta? <Link href="/login">Iniciá sesión</Link>
      </p>
    </main>
  );
}
