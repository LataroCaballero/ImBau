// makeR2Client — the single configured S3Client shared by @imbau/api (presign) and
// apps/worker (get/put) against Cloudflare R2 (RESEARCH Pattern 1, §158-181).
//
// Mirrors the "factory that takes validated config and returns the client" shape of
// packages/db/src/client.ts's createOwnerDb: the caller passes an already-validated `env`
// object — we NEVER read process.env here, so the factory stays pure-ish, testable, and
// reusable from any app's validated env (the api/worker env.ts own the Zod parse).
//
// CRITICAL (the load-bearing R2 config, RESEARCH Pitfall 1 §320-324):
// aws-sdk-js-v3 >= 3.729 defaults requestChecksumCalculation to "WHEN_SUPPORTED", which
// adds a CRC32 streaming trailer (STREAMING-UNSIGNED-PAYLOAD-TRAILER) that R2 rejects with a
// 400 / XAmzContentSHA256Mismatch on PutObject. Opting BOTH settings out to "WHEN_REQUIRED"
// is the documented fix (Cloudflare R2 + aws-sdk-js-v3 issue #6893) and the nº1 R2
// integration break — without it every upload to R2 fails.
import { S3Client } from "@aws-sdk/client-s3";

// Only the credential/endpoint subset of r2Env is needed to build the client (the bucket +
// public base URL are used by callers, not by the S3Client itself).
export interface R2ClientEnv {
  readonly R2_ACCOUNT_ID: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
}

export function makeR2Client(env: R2ClientEnv): S3Client {
  return new S3Client({
    // region "auto" is required by the SDK and ignored by R2.
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // CRITICAL: opt OUT of the new CRC32 streaming trailer — R2 rejects it (Pitfall 1).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
