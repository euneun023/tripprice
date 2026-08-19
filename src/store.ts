/**
 * Flat JSON file persistence for the PoC. Explicitly not a database - this
 * PoC step tests the mapping/refresh *logic*, not storage infrastructure.
 * Phase 1 replaces this file with a real table; the shape (ApprovedSourceMapping)
 * is what should carry over.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ApprovedSourceMapping } from "./types";

const STORE_PATH = new URL("../data/approved-mappings.json", import.meta.url);

export async function loadMappings(): Promise<ApprovedSourceMapping[]> {
  if (!existsSync(STORE_PATH)) return [];
  const text = await readFile(STORE_PATH, "utf-8");
  return JSON.parse(text) as ApprovedSourceMapping[];
}

export async function saveMappings(mappings: ApprovedSourceMapping[]): Promise<void> {
  await writeFile(STORE_PATH, JSON.stringify(mappings, null, 2), "utf-8");
}
