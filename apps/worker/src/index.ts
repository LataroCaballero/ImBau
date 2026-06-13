// Import env FIRST so validation runs at boot and fails closed on bad/missing
// vars (MONO-03, D-03). This is a deployable shell only: no BullMQ / job logic
// in phase 0 (out of scope, APP-03 — heavy jobs land with media/PDFs later).
import { env } from "./env";

console.log(
  JSON.stringify({ msg: "worker boot ok", node_env: env.NODE_ENV }),
);
