/** Usage: npm run audit:wau -- KR.csv JP.csv review.csv OUTPUT_DIR YYYY-MM-DD
 * Explicitly offline. No environment/secrets, network, repositories, or production imports. */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseCsv, writeCsv } from "../feeds/csv";
import { auditWau } from "../feeds/wau";

const [krPath, jpPath, reviewPath, outputPath, asOf] = process.argv.slice(2);
if (!krPath || !jpPath || !reviewPath || !outputPath || !asOf) throw new Error("Required: KR.csv JP.csv review.csv OUTPUT_DIR YYYY-MM-DD");
const output = resolve(outputPath);
if (existsSync(output)) throw new Error("Output directory already exists; choose a new directory");
const inputs = [krPath, jpPath, reviewPath].map(path => ({ path, bytes: readFileSync(path) }));
const result = auditWau(...inputs.map(i => parseCsv(i.bytes.toString("utf8"))) as [ReturnType<typeof parseCsv>, ReturnType<typeof parseCsv>, ReturnType<typeof parseCsv>], asOf);
mkdirSync(output, { recursive: true });
const flattened = result.map(r => ({ ...r, issues: r.issues.join(";"), publicationHolds: r.publicationHolds.join(";") }));
const headers = Object.keys(flattened[0]);
for (const [name, rows] of [
  ["all-products.csv", flattened],
  ["verified-products.csv", flattened.filter(r => r.snapshotVerified)],
  ["problem-products.csv", flattened.filter(r => !r.snapshotVerified)],
] as const) writeFileSync(resolve(output, name), writeCsv(headers, rows));
writeFileSync(resolve(output, "staging.json"), JSON.stringify(result, null, 2) + "\n");
const summary = { asOf, evidenceScope: "supplied CSV snapshot; no live product checks", total: result.length,
  snapshotVerified: result.filter(r => r.snapshotVerified).length, problems: result.filter(r => !r.snapshotVerified).length,
  publicationAllowed: 0, issues: Object.fromEntries([...new Set(result.flatMap(r => r.issues))].map(reason => [reason, result.filter(r => r.issues.includes(reason)).length])),
  inputs: inputs.map(i => ({ filename: i.path.split(/[\\/]/).at(-1), sha256: createHash("sha256").update(i.bytes).digest("hex") })) };
writeFileSync(resolve(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
