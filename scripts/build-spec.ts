/**
 * Fetch Datadog v1 + v2 OpenAPI specs, resolve $refs, filter to allowed
 * operations, merge, and output spec.json + products.ts.
 *
 * Run with: bun run scripts/build-spec.ts
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { isAllowedSpecEndpoint } from "../src/allowlist";

export const SPEC_URLS = {
  v1: "https://raw.githubusercontent.com/DataDog/documentation/master/data/api/v1/full_spec.yaml",
  v2: "https://raw.githubusercontent.com/DataDog/documentation/master/data/api/v2/full_spec.yaml",
} as const;

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "src/data");
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OperationObject {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Resolve all $ref pointers inline. Tracks seen refs to handle circular references.
 */
function resolveRefs(
  obj: unknown,
  root: OpenAPISpec,
  seen = new Set<string>(),
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj))
    return obj.map((item) => resolveRefs(item, root, seen));

  const record = obj as Record<string, unknown>;

  if ("$ref" in record && typeof record.$ref === "string") {
    const ref = record.$ref;
    if (seen.has(ref)) return { $circular: ref };
    seen.add(ref);

    const parts = ref.replace("#/", "").split("/");
    let resolved: unknown = root;
    for (const part of parts) {
      resolved = (resolved as Record<string, unknown>)?.[part];
    }
    return resolveRefs(resolved, root, seen);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = resolveRefs(value, root, seen);
  }
  return result;
}

/**
 * Extract the primary product/tag from a Datadog API path.
 * e.g. /api/v1/monitor -> "monitor", /api/v2/logs/events/search -> "logs"
 */
function extractProduct(path: string): string | undefined {
  const match = path.match(/\/api\/v[12]\/([^/]+)/);
  return match?.[1];
}

/**
 * Process one OpenAPI spec: resolve refs, filter endpoints, extract operations.
 */
function processSpec(spec: OpenAPISpec): {
  paths: Record<string, Record<string, unknown>>;
  products: Map<string, number>;
  endpointCount: number;
  removedCount: number;
} {
  const paths: Record<string, Record<string, unknown>> = {};
  const products = new Map<string, number>();
  let endpointCount = 0;
  let removedCount = 0;

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue;

    const methods: Record<string, unknown> = {};
    let hasMethod = false;

    for (const method of HTTP_METHODS) {
      const op = pathItem[method] as OperationObject | undefined;
      if (!op) continue;

      if (!isAllowedSpecEndpoint(method, path)) {
        removedCount++;
        continue;
      }

      const product = extractProduct(path);
      const tags = op.tags ? [...op.tags] : [];
      if (product && !tags.some((t) => t.toLowerCase() === product.toLowerCase())) {
        tags.unshift(product);
      }

      methods[method] = {
        summary: op.summary,
        description: op.description,
        tags,
        parameters: resolveRefs(op.parameters, spec),
        requestBody: resolveRefs(op.requestBody, spec),
        responses: resolveRefs(op.responses, spec),
      };
      hasMethod = true;
      endpointCount++;

      if (product) {
        products.set(product, (products.get(product) ?? 0) + 1);
      }
    }

    if (hasMethod) {
      paths[path] = methods;
    }
  }

  return { paths, products, endpointCount, removedCount };
}

interface FetchResult {
  spec: OpenAPISpec;
  contentLength: number;
}

async function fetchSpec(url: string, label: string): Promise<FetchResult> {
  console.log(`Fetching ${label} spec from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label} spec: ${response.status}`);
  }
  const text = await response.text();
  const contentLength = Number(response.headers.get("content-length") ?? text.length);
  return { spec: YAML.parse(text) as OpenAPISpec, contentLength };
}

export async function buildSpec() {
  const [v1Result, v2Result] = await Promise.all([
    fetchSpec(SPEC_URLS.v1, "v1"),
    fetchSpec(SPEC_URLS.v2, "v2"),
  ]);

  console.log(
    `v1: ${Object.keys(v1Result.spec.paths ?? {}).length} paths, v2: ${Object.keys(v2Result.spec.paths ?? {}).length} paths`,
  );

  const v1 = processSpec(v1Result.spec);
  const v2 = processSpec(v2Result.spec);

  // Merge (paths are already namespaced /api/v1/... and /api/v2/...)
  const mergedPaths = { ...v1.paths, ...v2.paths };
  const mergedProducts = new Map<string, number>();
  for (const [p, c] of v1.products) mergedProducts.set(p, c);
  for (const [p, c] of v2.products)
    mergedProducts.set(p, (mergedProducts.get(p) ?? 0) + c);

  const totalEndpoints = v1.endpointCount + v2.endpointCount;
  const totalRemoved = v1.removedCount + v2.removedCount;
  const totalPaths = Object.keys(mergedPaths).length;

  console.log(`Merged: ${totalPaths} paths, ${totalEndpoints} endpoints`);
  console.log(`Removed ${totalRemoved} disallowed write endpoints`);

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Write spec.json
  const specJson = JSON.stringify({ paths: mergedPaths }, null, 2);
  const specFile = `${OUTPUT_DIR}/spec.json`;
  await writeFile(specFile, specJson);
  console.log(`Wrote ${specFile} (${(specJson.length / 1024).toFixed(0)} KB)`);

  // Verify no remaining $refs (check actual JSON keys, not string mentions)
  const parsed = JSON.parse(specJson);
  const countRefs = (obj: unknown): number => {
    if (obj === null || obj === undefined || typeof obj !== "object") return 0;
    if (Array.isArray(obj)) return obj.reduce((n, item) => n + countRefs(item), 0);
    const rec = obj as Record<string, unknown>;
    let count = "$ref" in rec ? 1 : 0;
    for (const v of Object.values(rec)) count += countRefs(v);
    return count;
  };
  const refCount = countRefs(parsed);
  if (refCount > 0) {
    console.warn(`WARNING: ${refCount} unresolved $ref(s) remain in spec.json`);
  } else {
    console.log("No unresolved $refs remain");
  }

  // Write products.ts
  const sortedProducts = [...mergedProducts.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  const productsContent = [
    "// Auto-generated list of Datadog API products (by endpoint count)",
    `export const PRODUCTS = ${JSON.stringify(sortedProducts.map(([p]) => p))} as const;`,
    "export type Product = (typeof PRODUCTS)[number];",
    "",
  ].join("\n");
  const productsFile = `${OUTPUT_DIR}/products.ts`;
  await writeFile(productsFile, productsContent);
  console.log(
    `Wrote ${productsFile} (${sortedProducts.length} products)`,
  );

  // Write build manifest for staleness detection
  const allowlistPath = path.join(PROJECT_ROOT, "src/allowlist.ts");
  const allowlistContent = await readFile(allowlistPath, "utf-8");
  const allowlistHash = createHash("sha256").update(allowlistContent).digest("hex");

  const manifest = {
    allowlistHash,
    v1ContentLength: v1Result.contentLength,
    v2ContentLength: v2Result.contentLength,
  };
  const manifestFile = path.join(PROJECT_ROOT, ".build-manifest.json");
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifestFile}`);
}

buildSpec().catch((err) => {
  console.error(err);
  process.exit(1);
});
