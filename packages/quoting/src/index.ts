// Public barrel for the quoting engine. Pure package — no I/O, ever (CLAUDE.md).
// The full surface (money primitives, calcQuote, serializers, formatters) is re-exported here
// as later plans land; for now the barrel exposes the versioned-output contract.
// ENGINE_VERSION is a runtime value, so a plain `export {}` re-export is correct under
// verbatimModuleSyntax.
export { ENGINE_VERSION } from "./version";
