// WhatsApp CTA e2e (WA-01) + phase gate.
//
// The CTA persists the quote once (quotes.create) and then navigates the top-level document to the
// pre-filled wa.me link. We never really open WhatsApp: a route interceptor on the fixed wa.me host
// captures the navigation target and fulfills a stub, so the assertion is on the URL the app built —
// its host is the fixed `https://wa.me/<digits>` (open-redirect guard, T-06-06-REDIRECT) and its
// `text` decodes to the unit/proyecto header + the toWhatsAppText amounts + the shareable deep-link.
//
// Flow: the picker path (not a bare deep-link) so the message header carries the REAL unit
// identificador (the simulator only knows it after a picker selection). We drive the priciest
// disponible unit, whose financiado quote is valid, so the result renders and the CTA enables.
import { test, expect } from "@playwright/test";
import { resolveSeed, type ResolvedSeed } from "./seed-helpers";

let seed: ResolvedSeed;

test.beforeAll(async () => {
  seed = await resolveSeed();
});

test.describe("WhatsApp CTA (WA-01)", () => {
  test("CTA opens a pre-filled wa.me URL; PDF button disabled", async ({
    page,
  }) => {
    // Intercept the off-site wa.me navigation: capture the URL, fulfill a stub so nothing external
    // is hit and the page does not error out.
    let waUrl: string | null = null;
    await page.route(/^https:\/\/wa\.me\//, async (route) => {
      waUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>wa stub</body></html>",
      });
    });

    // Picker flow → real unit identificador in the CTA header.
    await page.goto(`/p/${seed.slug}/cotizador`);
    await page
      .getByRole("button")
      .filter({ hasText: seed.resultUnit.floorNombre })
      .first()
      .click();
    await page
      .getByRole("button")
      .filter({ hasText: seed.resultUnit.identificador })
      .first()
      .click();

    // The result computed → the CTA is present + enabled; the PDF button is a disabled placeholder.
    await expect(page.getByRole("heading", { name: "Financiado" })).toBeVisible();
    const cta = page.getByRole("button", { name: "Consultar por WhatsApp" });
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
    const pdf = page.getByRole("button", { name: /Descargar PDF/ });
    await expect(pdf).toBeVisible();
    await expect(pdf).toBeDisabled();

    // Fire the CTA — persist once, then navigate to wa.me (intercepted).
    await cta.click();
    await expect.poll(() => waUrl, { timeout: 15_000 }).not.toBeNull();

    const url = new URL(waUrl!);
    // Fixed host + seeded digits only (open-redirect guard).
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://wa.me/${seed.whatsappDigits}`,
    );
    // The decoded text carries the header (unit + proyecto), a toWhatsAppText amount, and the
    // shareable deep-link back to this exact selection.
    const text = url.searchParams.get("text") ?? "";
    expect(text).toContain(seed.projectNombre);
    expect(text).toContain(seed.resultUnit.identificador);
    expect(text).toMatch(/US\$ \d/);
    expect(text).toContain(`?u=${seed.resultUnit.id}`);
  });
});
