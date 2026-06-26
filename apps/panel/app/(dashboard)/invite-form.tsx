"use client";

// Invite form island (AUTH-03 / D-12) — owner-only member invitation.
//
// Calls the tRPC member.invite mutation (requireRole("owner") on the server, so a non-owner is
// rejected with FORBIDDEN — the form is gated server-side, not just hidden). The default role is
// "viewer" (least privilege — D-12). In dev the server logs the accept link to the console
// (D-09 fallback); in staging Resend sends the es-AR email. es-AR voseo, minimal UI (D-13).
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "../../lib/trpc-client";

type Role = "owner" | "developer" | "viewer";

export function InviteForm(): React.JSX.Element {
  const trpc = useTRPC();
  const invite = useMutation(trpc.member.invite.mutationOptions());
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    invite.mutate({ email, role });
  }

  return (
    <form onSubmit={onSubmit}>
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
        Rol
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="viewer">Viewer</option>
          <option value="developer">Developer</option>
          <option value="owner">Owner</option>
        </select>
      </label>
      <button type="submit" disabled={invite.isPending}>
        {invite.isPending ? "Invitando…" : "Invitar"}
      </button>
      {invite.isSuccess ? (
        <p role="status">Invitación enviada a {email}.</p>
      ) : null}
      {invite.isError ? (
        <p role="alert">
          No pudimos enviar la invitación: {invite.error.message}
        </p>
      ) : null}
    </form>
  );
}
