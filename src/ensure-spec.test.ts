import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { hashFile, checkStaleness } from "./ensure-spec";
import { writeFile, mkdir, rm, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, ".build-manifest.json");
const ALLOWLIST_PATH = path.join(PROJECT_ROOT, "src/allowlist.ts");
const SPEC_PATH = path.join(PROJECT_ROOT, "src/data/spec.json");

/**
 * Compute the expected hash for a file using the same algorithm as ensure-spec.
 */
function expectedHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Create a type-safe fetch mock by adding the required `preconnect` stub.
 */
function mockFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch {
  const mock = fn as typeof fetch;
  mock.preconnect = () => {};
  return mock;
}

describe("hashFile", () => {
  test("produces consistent SHA-256 hex digest", async () => {
    const hash = await hashFile(ALLOWLIST_PATH);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("matches node:crypto for the same file", async () => {
    const content = readFileSync(ALLOWLIST_PATH, "utf-8");
    const expected = expectedHash(content);
    const actual = await hashFile(ALLOWLIST_PATH);
    expect(actual).toBe(expected);
  });

  test("returns different hash for different content", async () => {
    const tmpFile = path.join(PROJECT_ROOT, ".test-hash-tmp");
    await writeFile(tmpFile, "hello");
    const h1 = await hashFile(tmpFile);
    await writeFile(tmpFile, "world");
    const h2 = await hashFile(tmpFile);
    await rm(tmpFile);
    expect(h1).not.toBe(h2);
  });
});

describe("checkStaleness", () => {
  let originalManifest: string | null = null;
  let manifestExisted = false;

  beforeEach(async () => {
    manifestExisted = existsSync(MANIFEST_PATH);
    if (manifestExisted) {
      originalManifest = readFileSync(MANIFEST_PATH, "utf-8");
    }
  });

  afterEach(async () => {
    // Restore original manifest state
    if (manifestExisted && originalManifest !== null) {
      await writeFile(MANIFEST_PATH, originalManifest);
    } else if (!manifestExisted && existsSync(MANIFEST_PATH)) {
      await rm(MANIFEST_PATH);
    }
  });

  test("returns reason when manifest is missing", async () => {
    if (existsSync(MANIFEST_PATH)) {
      await rm(MANIFEST_PATH);
    }
    const reason = await checkStaleness();
    expect(reason).toBe("no build manifest found");
  });

  test("returns reason when spec.json is missing", async () => {
    // Write a valid manifest but ensure spec.json doesn't exist
    const allowlistContent = readFileSync(ALLOWLIST_PATH, "utf-8");
    const manifest = {
      allowlistHash: expectedHash(allowlistContent),
      v1ContentLength: 999999,
      v2ContentLength: 999999,
    };
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

    // Temporarily move spec.json if it exists
    const specExisted = existsSync(SPEC_PATH);
    const specBackup = SPEC_PATH + ".bak";
    if (specExisted) {
      await rename(SPEC_PATH, specBackup);
    }

    try {
      const reason = await checkStaleness();
      expect(reason).toBe("spec.json missing");
    } finally {
      if (specExisted) {
        await rename(specBackup, SPEC_PATH);
      }
    }
  });

  test("returns reason when allowlist hash differs", async () => {
    const manifest = {
      allowlistHash: "0000000000000000000000000000000000000000000000000000000000000000",
      v1ContentLength: 999999,
      v2ContentLength: 999999,
    };
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

    // Only run if spec.json exists (otherwise we'd get "spec.json missing" first)
    if (!existsSync(SPEC_PATH)) return;

    const reason = await checkStaleness();
    expect(reason).toBe("allowlist.ts changed");
  });

  test("returns null when manifest matches and network is unreachable", async () => {
    // Only run if spec.json exists
    if (!existsSync(SPEC_PATH)) return;

    const allowlistContent = readFileSync(ALLOWLIST_PATH, "utf-8");
    const manifest = {
      allowlistHash: expectedHash(allowlistContent),
      // Use values that won't match real upstream, but since we mock fetch to fail
      // the network check is skipped gracefully
      v1ContentLength: 12345,
      v2ContentLength: 67890,
    };
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

    // Mock fetch to simulate network failure
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(() => Promise.reject(new Error("network down")));

    try {
      const reason = await checkStaleness();
      expect(reason).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("detects upstream v1 spec change via Content-Length mismatch", async () => {
    if (!existsSync(SPEC_PATH)) return;

    const allowlistContent = readFileSync(ALLOWLIST_PATH, "utf-8");
    const manifest = {
      allowlistHash: expectedHash(allowlistContent),
      v1ContentLength: 1,
      v2ContentLength: 67890,
    };
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v1/")) {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: { "content-length": "99999" },
        }));
      }
      return Promise.reject(new Error("network down"));
    });

    try {
      const reason = await checkStaleness();
      expect(reason).toBe("upstream v1 spec changed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("detects upstream v2 spec change via Content-Length mismatch", async () => {
    if (!existsSync(SPEC_PATH)) return;

    const allowlistContent = readFileSync(ALLOWLIST_PATH, "utf-8");
    const manifest = {
      allowlistHash: expectedHash(allowlistContent),
      v1ContentLength: 12345,
      v2ContentLength: 1,
    };
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v1/")) {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: { "content-length": "12345" },
        }));
      }
      if (url.includes("/v2/")) {
        return Promise.resolve(new Response(null, {
          status: 200,
          headers: { "content-length": "99999" },
        }));
      }
      return Promise.reject(new Error("network down"));
    });

    try {
      const reason = await checkStaleness();
      expect(reason).toBe("upstream v2 spec changed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
