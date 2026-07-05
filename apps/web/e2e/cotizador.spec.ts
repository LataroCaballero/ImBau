// Result render + comparison + leyenda + es-AR amounts + slider e2e (UI-02..06).
//
// Drives a deep-linked result view for the priciest disponible unit (a guaranteed-valid financiado
// quote — cheap units + a high-refuerzo plan legitimately fail with SALDO_NO_POSITIVO, the soft-error
// path) and asserts the full buyer-facing surface:
//  - UI-02: the financiado card shows precio / anticipo(%) / cuotas / primera cuota ARS / refuerzos /
//    totals;
//  - UI-03: Contado + Financiado cards render together with the compareQuotes savings band;
//  - UI-06: amounts match the deterministic formatUsd/formatArs shape (`US$ ` ASCII-space label,
//    `$ 1.234,56` es-AR grouping) — NOT Intl currency output (which injects a U+202F narrow space);
//  - UI-04: moving the preset slider swaps the plan (URL `?plan=` + displayed cuotas change);
//  - UI-05: the notasLegales + "no vinculante" leyenda is visible.
// A closing slider burst asserts the 429 soft-tolerance never surfaces a raw error/stack (Pitfall 4).
import { test, expect } from "@playwright/test";
import { resolveSeed, type ResolvedSeed } from "./seed-helpers";

let seed: ResolvedSeed;

test.beforeAll(async () => {
  seed = await resolveSeed();
});

test.describe("cotizador result render (UI-02..06)", () => {
  test("result, comparison, es-AR amounts, slider, leyenda", async ({ page }) => {
    const planA = seed.plans[0]!; // sorted index 0
    const planB = seed.plans[1]!; // sorted index 1
    await page.goto(
      `/p/${seed.slug}/cotizador?u=${seed.resultUnit.id}&plan=${planA.id}`,
    );

    // Both comparison cards render (UI-03).
    await expect(page.getByRole("heading", { name: "Financiado" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contado" })).toBeVisible();

    // UI-02: the financiado card breakdown.
    await expect(page.getByText(/Anticipo \(\d+(?:\.\d+)?%\)/)).toBeVisible();
    await expect(page.getByText("Cuotas", { exact: true })).toBeVisible();
    await expect(page.getByText(/Primera cuota/)).toBeVisible();
    await expect(page.getByText(/Refuerzos/)).toBeVisible();
    await expect(page.getByText("Total", { exact: true })).toBeVisible();

    // UI-03: the compareQuotes savings band.
    await expect(page.getByText(/Pagando al contado ahorrás/)).toBeVisible();

    // UI-06: the deterministic es-AR formatter output, not Intl currency style.
    const mainText = await page.locator("main").innerText();
    expect(mainText).toMatch(/US\$ \d[\d.]*/); // formatUsd: `US$ ` + dot thousands
    expect(mainText).toMatch(/\$ \d{1,3}(?:\.\d{3})+,\d{2}/); // formatArs: es-AR grouping + comma decimals
    expect(mainText).not.toContain("\u202F"); // no U+202F narrow no-break space (the Intl currency-style tell)

    // UI-04: the slider is enabled (a single-plan project would render it disabled) and moving it to
    // the next preset stop swaps the plan — the URL `?plan=` and the displayed cuotas both change.
    const slider = page.getByLabel("Plan de pago");
    await expect(slider).toBeEnabled();
    // Target the slider readout uniquely (the "% anticipo · N cuotas" line) — "N cuotas" alone also
    // appears in the plan's notasLegales.
    await expect(
      page.getByText(new RegExp(`% anticipo.*${planA.cuotas} cuotas`)),
    ).toBeVisible();

    await slider.fill("1");
    await page.waitForURL(new RegExp(`plan=${planB.id}`));
    await expect(
      page.getByText(new RegExp(`% anticipo.*${planB.cuotas} cuotas`)),
    ).toBeVisible();

    // UI-05: the leyenda (plan notasLegales + the fixed "no vinculante" line).
    await expect(page.getByText("Cotización no vinculante.")).toBeVisible();
    await expect(page.getByText(/índice CAC/)).toBeVisible();

    // Pitfall 4 (QUOTE-03 429 soft-tolerance): a rapid slider burst must never surface a raw
    // error/stack — the UI stays functional (a formatUsd figure remains) and shows at most a soft
    // es-AR message.
    for (const v of ["0", "1", "0", "1", "0"]) {
      await slider.fill(v);
    }
    await expect(page.getByText(/US\$ \d/).first()).toBeVisible();
    const afterBurst = await page.locator("main").innerText();
    expect(afterBurst).not.toMatch(/TRPCClientError|at Object\.|\bTypeError\b/);
  });
});
