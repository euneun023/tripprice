/**
 * Checks for the offline supply-path sampler. Run: npx tsx src/scripts/sample-supply-paths.test.ts
 * Pure/in-memory over the repo's own files: no network, DB or .env.
 */
import { QUOTA, pathsFor, select, unify, type Unified } from "./sample-supply-paths";
import type { Row } from "./run-listing-intake";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const row = (source: string, id: string, title: string, type: string | null, model: string | null = null, human?: string): Row => ({ source, id, title, brand: null, model, productType: type as Row["productType"], humanCategory: human });
const rows: Row[] = [
  row("baseline", "a", "Sony FE 24mm F1.4 GM", "camera_lens", null, "exact"),
  row("seed", "b", "Sony FE 24mm F1.4 GM", "camera_lens", "SEL24F14GM"), // same product, two sources -> one entry, model kept
  row("baseline", "c", "Tamron 12-20mm F2.8", "camera_lens", null, "missing_source"),
  row("baseline", "d", "Sigma 35mm F1.4", "camera_lens", null, "exact"),
  row("baseline", "e", "Fujifilm X-T50", "camera", null, "exact"),
];
const all = unify(rows, new Map(), []);
check("same product from two sources collapses to one entry and keeps the model number", [all.length, all.find((u) => u.title.includes("24mm"))?.model, all.find((u) => u.title.includes("24mm"))?.sources], [4, "SEL24F14GM", ["baseline", "seed"]]);
const s1 = select(all, { camera_lens: 3, camera: 1 });
check("selection is deterministic", JSON.stringify(select(all, { camera_lens: 3, camera: 1 })), JSON.stringify(s1));
check("quota respected, no duplicates", [s1.length, new Set(s1.map((u) => u.key)).size], [4, 4]);
const lens2 = select(all, { camera_lens: 2 });
check("a model-known product is preferred, and a no-model one is kept so the sample is not only easy cases", [lens2.some((u) => u.model !== null), lens2.some((u) => u.model === null)], [true, true]);
check("default quota is 20-30 products", Object.values(QUOTA).reduce((a, b) => a + b, 0) >= 20 && Object.values(QUOTA).reduce((a, b) => a + b, 0) <= 30, true);

const u = (over: Partial<Unified>): Unified => ({ key: "k", title: "t", type: "camera", brand: null, model: null, sources: [], priorReview: "none", csvKrUrl: false, csvJpUrl: false, approvedJp: false, approvedKr: false, ...over });
check("name-only product is flagged weak/human-review, never an identity", pathsFor(u({ model: null })).join.startsWith("NO model number"), true);
check("roll-up price is declared discovery-only in every planned path", pathsFor(u({})).jpDiscovery.includes("discovery only"), true);
check("niche diving product notes that KR specialty shops have no API", pathsFor(u({ type: "fins" })).krSellerPrices.includes("NO API"), true);
check("unknown rights are marked UNKNOWN in the paths (not presented as usable)", pathsFor(u({})).krSellerPrices.includes("UNKNOWN") && pathsFor(u({})).jpSellerPrice.includes("UNKNOWN"), true);

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
