/**
 * Auto-rebuild spec on staleness. Checks two signals:
 * 1. Upstream Datadog spec changed (Content-Length from HEAD requests)
 * 2. Local allowlist.ts changed (file hash)
 *
 * Compares against .build-manifest.json written at build time.
 */

import path from "node:path";
import { SPEC_URLS, buildSpec } from "../scripts/build-spec";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, ".build-manifest.json");
const ALLOWLIST_PATH = path.join(PROJECT_ROOT, "src/allowlist.ts");
const SPEC_PATH = path.join(PROJECT_ROOT, "src/data/spec.json");

interface BuildManifest {
  allowlistHash: string;
  v1ContentLength: number;
  v2ContentLength: number;
}

export async function hashFile(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const content = await file.text();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

async function readManifest(): Promise<BuildManifest | null> {
  const file = Bun.file(MANIFEST_PATH);
  if (!(await file.exists())) return null;
  return file.json() as Promise<BuildManifest>;
}

async function specExists(): Promise<boolean> {
  return Bun.file(SPEC_PATH).exists();
}

/**
 * Fetch Content-Length via HEAD requests with a timeout.
 * Returns null on any failure (network error, timeout, missing header).
 */
async function fetchContentLength(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const header = response.headers.get("content-length");
    if (header === null) return null;
    return Number(header);
  } catch {
    return null;
  }
}

/**
 * Determine if the spec needs rebuilding by comparing the current state
 * against the build manifest. Returns a reason string if stale, null if fresh.
 */
export async function checkStaleness(): Promise<string | null> {
  const manifest = await readManifest();
  if (!manifest) return "no build manifest found";

  if (!(await specExists())) return "spec.json missing";

  const currentHash = await hashFile(ALLOWLIST_PATH);
  if (currentHash !== manifest.allowlistHash) return "allowlist.ts changed";

  const [v1Length, v2Length] = await Promise.all([
    fetchContentLength(SPEC_URLS.v1),
    fetchContentLength(SPEC_URLS.v2),
  ]);

  // Network failures are non-fatal; only trigger rebuild on confirmed mismatch
  if (v1Length !== null && v1Length !== manifest.v1ContentLength) {
    return "upstream v1 spec changed";
  }
  if (v2Length !== null && v2Length !== manifest.v2ContentLength) {
    return "upstream v2 spec changed";
  }

  if (v1Length === null && v2Length === null) {
    console.warn("Could not reach upstream specs to check for updates");
  }

  return null;
}

export async function ensureSpec(): Promise<void> {
  const reason = await checkStaleness();
  if (reason === null) return;

  console.log(`Rebuilding spec: ${reason}`);
  await buildSpec();
}
