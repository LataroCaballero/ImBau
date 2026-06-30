import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/node";
import { logger } from "@imbau/observability";
import { MEDIA_QUEUE } from "@imbau/storage";
import { reportMediaFailure } from "./media";

// Pure unit test for the observable failure path (MEDIA-04 / T-02-11). reportMediaFailure must
// route a media-job error to BOTH Sentry.captureException (with mediaId/attempts as searchable
// context) AND the structured pino logger — and never swallow it. This is the regression guard
// for "errors observable, never silenced" (CLAUDE.md).
//
// NO infra: only mocks/spies. @sentry/node's real ESM namespace is non-configurable, so we mock
// the module (factory) rather than vi.spyOn it; the pino logger (a @imbau/observability instance)
// is spyable directly. No Redis/Postgres/R2 connection is ever opened (importing ./media builds
// the R2 S3Client + lazy @imbau/db pools, but neither contacts the network at import).
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(() => "event-id"),
}));

describe("reportMediaFailure (pure, mocked Sentry + spied pino)", () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the error to Sentry AND pino with the mediaId/attempts/queue, never swallowing it", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const err = new Error("boom");
    reportMediaFailure(err, { mediaId: "m1", attempts: 3 });

    // Sentry: the exact error + searchable extra context.
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { mediaId: "m1", attempts: 3 },
    });

    // pino: structured fields { err, mediaId, queue } + the canonical message.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const call = errorSpy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [obj, msg] = call;
    expect(obj).toMatchObject({ err, mediaId: "m1", queue: MEDIA_QUEUE });
    expect(msg).toBe("media job failed");
  });

  it("still reports when mediaId/attempts are absent (undefined context is passed through)", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const err = new Error("no-context");
    reportMediaFailure(err, {});

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { mediaId: undefined, attempts: undefined },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const call = errorSpy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call[0]).toMatchObject({ err, queue: MEDIA_QUEUE });
  });
});
