/**
 * Phase 1 reorganization: the real implementation moved to src/adapters/rakuten.ts
 * (adapters are DB-agnostic by design - see docs/phase1-design.md §9). This
 * file is kept as a re-export so the existing PoC scripts (verify-rakuten*.ts,
 * bootstrap-mappings.ts, refresh-mappings.ts) keep working unchanged.
 */
export * from "../adapters/rakuten";
