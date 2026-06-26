// Panel auth e2e (AUTH-01 / AUTH-02 / AUTH-03, D-09/D-10).
//
// Test 1 ("login persists") — signup creates a user + first org (auto-activated), the dashboard
// RSC reads that org's projects through withTenant, and the session survives a full page reload
// (the cookie set by nextCookies() persists — AUTH-01 / T-03-10).
//
// Test 2 ("invite accept creates member") — an owner invites an email as `viewer`; RESEND_API_KEY
// is unset so the dispatch takes the dev console fallback (D-09, no real email). The spec reads
// the invitation id straight from Postgres (the fallback only logs the accept link to the server
// stdout, which Playwright cannot pass to a test), opens /accept-invitation/[id] in a fresh
// browser context, signs the invitee up, and asserts a `member` row lands with role `viewer`
// (AUTH-03 / T-03-15: the assigned role is honored).
import { test, expect } from "@playwright/test";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://imbau:dev@localhost:5432/imbau";

// A short, unique tag so parallel/re-runs never collide on email or slug.
function uniq(): string {
  return Math.random().toString(36).slice(2, 10);
}

test.describe("panel auth", () => {
  test("login persists across a reload after signup", async ({ page }) => {
    const tag = uniq();
    const email = `e2e-${tag}@example.test`;
    const password = `Pw-${tag}-abcd`;

    await page.goto("/signup");
    await page.getByLabel("Nombre", { exact: true }).fill(`E2E ${tag}`);
    await page.getByLabel("Correo").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page
      .getByLabel("Nombre de tu organización")
      .fill(`Org ${tag}`);
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    // We land on the dashboard (/) after signup + org activation.
    await expect(
      page.getByRole("heading", { name: "Panel · Proyectos" }),
    ).toBeVisible();

    // Reload the page: the session cookie must persist us on the dashboard (not bounced to
    // /login). This is the AUTH-01 exit criterion.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Panel · Proyectos" }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("invite accept creates member with the assigned role", async ({
    browser,
  }) => {
    const sql = postgres(DATABASE_URL, { max: 1 });
    try {
      const tag = uniq();
      const ownerEmail = `e2e-owner-${tag}@example.test`;
      const ownerPassword = `Pw-${tag}-owner`;
      const inviteeEmail = `e2e-invitee-${tag}@example.test`;
      const inviteePassword = `Pw-${tag}-invitee`;

      // --- Owner: sign up, create + activate an org, land on the dashboard. ---
      const ownerCtx = await browser.newContext();
      const ownerPage = await ownerCtx.newPage();
      await ownerPage.goto("/signup");
      await ownerPage
        .getByLabel("Nombre", { exact: true })
        .fill(`Owner ${tag}`);
      await ownerPage.getByLabel("Correo").fill(ownerEmail);
      await ownerPage.getByLabel("Contraseña").fill(ownerPassword);
      await ownerPage
        .getByLabel("Nombre de tu organización")
        .fill(`Org ${tag}`);
      await ownerPage.getByRole("button", { name: "Crear cuenta" }).click();
      await expect(
        ownerPage.getByRole("heading", { name: "Panel · Proyectos" }),
      ).toBeVisible();

      // --- Owner invites the invitee as `viewer` (the form default). ---
      await ownerPage.getByLabel("Correo").fill(inviteeEmail);
      // Role select already defaults to "viewer"; submit the invite.
      await ownerPage.getByRole("button", { name: "Invitar" }).click();
      await expect(ownerPage.getByRole("status")).toContainText(
        inviteeEmail,
      );

      // The dev fallback logged the link; we read the invitation id from Postgres to drive accept.
      async function pendingInvitationId(): Promise<string | null> {
        const rows = await sql<{ id: string }[]>`
          select id from invitation
          where email = ${inviteeEmail} and status = 'pending'
          order by expires_at desc limit 1
        `;
        return rows[0]?.id ?? null;
      }
      await expect.poll(pendingInvitationId, { timeout: 15_000 }).not.toBeNull();
      const invitationId = await pendingInvitationId();
      if (invitationId === null) {
        throw new Error("invitation row never appeared for the invitee");
      }

      // --- Invitee: open the accept link in a FRESH context, sign up, accept. ---
      const inviteeCtx = await browser.newContext();
      const inviteePage = await inviteeCtx.newPage();
      await inviteePage.goto(`/accept-invitation/${invitationId}`);
      // Default mode is signup (a brand-new invitee).
      await inviteePage
        .getByLabel("Nombre", { exact: true })
        .fill(`Invitee ${tag}`);
      await inviteePage.getByLabel("Correo").fill(inviteeEmail);
      await inviteePage.getByLabel("Contraseña").fill(inviteePassword);
      await inviteePage
        .getByRole("button", { name: "Crear cuenta y aceptar" })
        .click();

      // The authoritative AUTH-03 outcome is the member row: the invitee becomes a member of the
      // owner's org with the assigned `viewer` role. Poll for it (the accept + member insert run
      // through the auth runtime once the session lands).
      async function inviteeMemberRole(): Promise<string | null> {
        const rows = await sql<{ role: string }[]>`
          select m.role
          from member m
          join "user" u on u.id = m.user_id
          join organization o on o.id = m.organization_id
          where u.email = ${inviteeEmail} and o.slug like ${`%${tag}%`}
        `;
        return rows[0]?.role ?? null;
      }
      await expect
        .poll(inviteeMemberRole, { timeout: 20_000 })
        .toBe("viewer");

      // And the invitee leaves the accept page for the dashboard (the accepted org is active).
      await expect(inviteePage).toHaveURL(/\/$/);
      await expect(
        inviteePage.getByRole("heading", { name: "Panel · Proyectos" }),
      ).toBeVisible();

      await ownerCtx.close();
      await inviteeCtx.close();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
