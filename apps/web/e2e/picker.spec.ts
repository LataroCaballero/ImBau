// Picker + deep-link e2e (UI-01).
//
// Two paths reach the cotizador result view:
//  1. The piso→unidad picker (no query params): the buyer picks a floor, then a unit — but only a
//     `disponible` unit is selectable (reservado/vendido render with their badge, disabled). Picking
//     a disponible unit leaves the picker and writes `?u=` (the shareable deep-link) to the URL.
//  2. A `?u=&plan=` deep-link renders the result view DIRECTLY — no picker step.
//
// Fixtures come from the seeded Brigos Recoleta project (resolveSeed → dev DB); ids/identificadores
// are resolved at runtime so a re-seed never rots the assertions.
import { test, expect } from "@playwright/test";
import { resolveSeed, type ResolvedSeed } from "./seed-helpers";

let seed: ResolvedSeed;

test.beforeAll(async () => {
  seed = await resolveSeed();
});

test.describe("cotizador picker + deep-link (UI-01)", () => {
  test("picker: floor→unit, only disponible selectable, reaches result with ?u", async ({
    page,
  }) => {
    await page.goto(`/p/${seed.slug}/cotizador`);

    // Step 1 — floors. Pick the mixed floor by its unique nombre (e.g. "Planta Baja").
    await expect(
      page.getByRole("heading", { name: "Elegí un piso" }),
    ).toBeVisible();
    await page
      .getByRole("button")
      .filter({ hasText: seed.mixedFloor.nombre })
      .first()
      .click();

    // Step 2 — units of that floor. Status badges render; a disponible unit is enabled and a
    // reservado/vendido unit is disabled (the disponible-only selectability rule, D-08).
    await expect(
      page.getByRole("heading", { name: "Elegí una unidad" }),
    ).toBeVisible();
    await expect(
      page.getByText("Disponible", { exact: true }).first(),
    ).toBeVisible();

    const disponibleBtn = page
      .getByRole("button")
      .filter({ hasText: seed.disponibleUnit.identificador })
      .first();
    const nonDisponibleBtn = page
      .getByRole("button")
      .filter({ hasText: seed.nonDisponibleUnit.identificador })
      .first();
    await expect(disponibleBtn).toBeEnabled();
    await expect(nonDisponibleBtn).toBeDisabled();

    // Selecting the disponible unit reveals the result view (the "Cambiar unidad" control appears)
    // and updates the URL with the shareable ?u= (+ the default ?plan=).
    await disponibleBtn.click();
    await expect(
      page.getByRole("button", { name: "← Cambiar unidad" }),
    ).toBeVisible();
    await page.waitForURL(/[?&]u=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("u")).toBe(seed.disponibleUnit.id);
    expect(url.searchParams.get("plan")).not.toBeNull();
  });

  test("deep-link: ?u=&plan= renders the result view directly, no picker", async ({
    page,
  }) => {
    const plan = seed.plans[0]!;
    await page.goto(
      `/p/${seed.slug}/cotizador?u=${seed.resultUnit.id}&plan=${plan.id}`,
    );

    // The result view is shown directly — the picker's floor step never appears.
    await expect(
      page.getByRole("button", { name: "← Cambiar unidad" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Elegí un piso" }),
    ).toHaveCount(0);

    // The result actually computes: a formatUsd figure renders (US$ …).
    await expect(page.getByText(/US\$\s\d[\d.]*/).first()).toBeVisible();
  });
});
