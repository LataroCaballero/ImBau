import { pino, type LoggerOptions } from "pino";

// Shared structured logger for all three apps (OBS-02, D-04). One transport
// definition serves BOTH self-hosted Loki and Grafana Cloud: swapping LOKI_URL
// (+ optional LOKI_BASIC_AUTH) repoints the SAME pino-loki transport with ~0
// local RAM and no Promtail/Alloy reconfig. This package owns no env.ts of its
// own — it reads raw process.env directly (the apps validate these names via the
// sentryEnv/lokiEnv presets in @imbau/config). pino-pretty is a devDependency
// only and is intentionally NOT referenced here: production/staging emit plain
// JSON to stdout, never pretty-printed (T-4-LOGLEAK: no secret values logged).

// pino-loki accepts basicAuth as `{ username, password }`. We parse it from the
// LOKI_BASIC_AUTH JSON string (never hardcoded — read from env/SOPS) and validate
// the shape before handing it to the transport.
type LokiBasicAuth = { username: string; password: string };

function parseBasicAuth(raw: string | undefined): LokiBasicAuth | undefined {
  if (!raw) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "username" in parsed &&
    "password" in parsed &&
    typeof (parsed as Record<string, unknown>).username === "string" &&
    typeof (parsed as Record<string, unknown>).password === "string"
  ) {
    return parsed as LokiBasicAuth;
  }
  throw new Error(
    "LOKI_BASIC_AUTH must be a JSON object with string `username` and `password`",
  );
}

const lokiUrl = process.env.LOKI_URL;

// When LOKI_URL is set, ship logs to Loki via the pino-loki transport; when it is
// unset (e.g. local dev), fall back to a plain-stdout-JSON pino instance (D-04
// fallback symmetry). pino-pretty stays out of this path by design.
const options: LoggerOptions = lokiUrl
  ? {
      transport: {
        target: "pino-loki",
        options: {
          host: lokiUrl, // internal http://loki:3100 OR Grafana Cloud push URL
          basicAuth: parseBasicAuth(process.env.LOKI_BASIC_AUTH),
          labels: {
            app: process.env.APP_NAME,
            env: process.env.NODE_ENV,
          },
          batching: true,
          interval: 5,
        },
      },
    }
  : {};

export const logger = pino(options);
