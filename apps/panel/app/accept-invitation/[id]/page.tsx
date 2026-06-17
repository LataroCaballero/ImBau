"use client";

// Accept-invitation page (AUTH-03 / D-10, D-13) — es-AR voseo client flow.
//
// The invitation email link lands here at /accept-invitation/[id]. Per D-10:
//   - a NEW invitee signs up first (no org of their own), then accepts;
//   - an EXISTING user logs in, then accepts.
// Either way, once a session exists we call authClient.organization.acceptInvitation, which
// writes the member row with the invited role and (in better-auth 1.6.18) makes the accepted org
// active. We then set it active explicitly as a belt-and-suspenders against the null-active-org
// gap (Pitfall 2) and enter the dashboard. The invitee never needs to create their own org.
import { use, useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "../../../lib/auth-client";

type Mode = "signup" | "login";

export default function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { id } = use(params);
  const { data: session, isPending: sessionPending } =
    authClient.useSession();

  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // A ref (not state) guards the accept attempt so it runs EXACTLY ONCE. Using a `pending` state
  // flag in the effect deps would make the effect cancel + re-run itself when setPending toggles,
  // aborting the in-flight accept before it could navigate.
  const startedRef = useRef(false);

  // Once authenticated, accept the invitation automatically (exactly once).
  useEffect(() => {
    if (sessionPending || !session?.user || startedRef.current) return;
    startedRef.current = true;
    setPending(true);
    void (async () => {
      const { data, error: acceptError } =
        await authClient.organization.acceptInvitation({ invitationId: id });
      if (acceptError || !data) {
        setPending(false);
        setError(
          acceptError?.message ?? "No pudimos aceptar la invitación.",
        );
        return;
      }
      // acceptInvitation creates the membership; we then set the accepted org active so the
      // dashboard does not bounce on a null active org (Pitfall 2). setActive is awaited because
      // the dashboard read needs it; a failure surfaces as an error rather than a silent bounce.
      const orgId =
        data.invitation?.organizationId ?? data.member?.organizationId;
      if (orgId) {
        const { error: activeError } =
          await authClient.organization.setActive({ organizationId: orgId });
        if (activeError) {
          setPending(false);
          setError(
            activeError.message ?? "No pudimos activar tu organización.",
          );
          return;
        }
      }
      // Hard navigation so the dashboard's first request carries the session cookie with the
      // freshly-set active org (a client-side router.push can race the cookie commit and land on
      // the dashboard before activeOrganizationId is set → a bounce to /login).
      window.location.assign("/");
    })();
  }, [sessionPending, session, id]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(
        result.error.message ??
          "No pudimos autenticarte para aceptar la invitación.",
      );
    }
    // On success the session updates and the effect above accepts the invitation.
  }

  if (sessionPending) {
    return (
      <main>
        <p>Cargando…</p>
      </main>
    );
  }

  if (session?.user) {
    return (
      <main>
        <h1>Aceptando tu invitación…</h1>
        {error ? <p role="alert">{error}</p> : <p>Un momento, por favor.</p>}
      </main>
    );
  }

  return (
    <main>
      <h1>Te invitaron a una organización</h1>
      <p>
        {mode === "signup"
          ? "Creá tu cuenta para aceptar la invitación."
          : "Iniciá sesión para aceptar la invitación."}
      </p>
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
      >
        {mode === "signup" ? (
          <label>
            Nombre
            <input
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        ) : null}
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
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={pending}>
          {mode === "signup" ? "Crear cuenta y aceptar" : "Ingresar y aceptar"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => setMode(mode === "signup" ? "login" : "signup")}
      >
        {mode === "signup"
          ? "¿Ya tenés cuenta? Iniciá sesión"
          : "¿No tenés cuenta? Registrate"}
      </button>
    </main>
  );
}
