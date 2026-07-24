// Unit test for the lead-notification dispatch (D-07, LEADS-04) — the dev/prod email branch.
//
// Three cases, cloning the send-invitation.test.ts mold and extending it with the Resend send +
// error paths:
//   (a) no RESEND_API_KEY  -> console summary, NO network (the dev fallback, D-09).
//   (b) key present        -> resend.emails.send called with from=INVITE_FROM, correct subject,
//                             and the deep-link in the template props.
//   (c) Resend error       -> throws (observable, never swallowed — CLAUDE.md).
//
// `resend` is mocked so no real network is ever touched. The key-present cases set process.env
// and re-import the module (vi.resetModules) so its dedicated createEnv re-reads the new env.
import { describe, it, expect, vi, afterEach } from "vitest";

const { sendMock, resendCtor } = vi.hoisted(() => {
  const sendMock = vi.fn();
  // A regular function (not an arrow) so `new Resend(key)` in the module works — the returned
  // object overrides `this`, giving the fake `emails.send`.
  const resendCtor = vi.fn(function fakeResend() {
    return { emails: { send: sendMock } };
  });
  return { sendMock, resendCtor };
});

vi.mock("resend", () => ({ Resend: resendCtor }));

const SAMPLE = {
  to: "avisos@brigos.test",
  nombre: "Ana Gómez",
  contacto: "+54 9 11 5555-5555",
  origen: "WhatsApp",
  projectNombre: "Brigos Recoleta",
  deepLink: "http://localhost:3001/proyectos/p1/leads",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  sendMock.mockReset();
  resendCtor.mockClear();
  delete process.env.RESEND_API_KEY;
  delete process.env.INVITE_FROM;
});

describe("lead notification dispatch", () => {
  it("logs the lead summary to console.info and touches no network when RESEND_API_KEY is absent", async () => {
    // The suite env intentionally leaves RESEND_API_KEY unset so the dev fallback fires.
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { sendLeadNotification } = await import(
      "../src/email/send-lead-notification"
    );
    await sendLeadNotification(SAMPLE);

    expect(info).toHaveBeenCalledTimes(1);
    const logged = info.mock.calls[0]?.[0] as string;
    // The line carries only the public lead summary — recipient, nombre, origen.
    expect(logged).toContain(SAMPLE.to);
    expect(logged).toContain(SAMPLE.nombre);
    expect(logged).toContain(SAMPLE.origen);
    // No secret on the line.
    expect(logged).not.toContain("RESEND");
    // No network.
    expect(resendCtor).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends via Resend from INVITE_FROM with the correct subject and deep-link when a key is present", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.INVITE_FROM = "ImBau <leads@imbau.test>";
    vi.resetModules();
    sendMock.mockResolvedValue({ error: null });

    const { sendLeadNotification } = await import(
      "../src/email/send-lead-notification"
    );
    await sendLeadNotification(SAMPLE);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0]?.[0] as {
      from: string;
      to: string;
      subject: string;
      react: unknown;
    };
    expect(arg.from).toBe("ImBau <leads@imbau.test>");
    expect(arg.to).toBe(SAMPLE.to);
    expect(arg.subject).toBe(`Tenés un lead nuevo en ${SAMPLE.projectNombre}`);
    // The template was rendered with the lead props: the deep-link CTA href and the lead fields
    // are threaded into the React Email element tree the recipient receives.
    const rendered = JSON.stringify(arg.react);
    expect(rendered).toContain(SAMPLE.deepLink);
    expect(rendered).toContain("Ver el lead en el panel");
    expect(rendered).toContain(SAMPLE.nombre);
  });

  it("throws with Resend's own error message (observable, no secret) when Resend returns an error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.INVITE_FROM = "ImBau <leads@imbau.test>";
    vi.resetModules();
    sendMock.mockResolvedValue({ error: { message: "domain not verified" } });

    const { sendLeadNotification } = await import(
      "../src/email/send-lead-notification"
    );

    await expect(sendLeadNotification(SAMPLE)).rejects.toThrow(
      /domain not verified/,
    );
  });
});
