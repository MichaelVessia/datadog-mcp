/**
 * Access control for Datadog API operations.
 *
 * Three tiers:
 * 1. GET/HEAD - always allowed
 * 2. Read-only POST endpoints (search, aggregate, query) - allowed by suffix pattern
 * 3. Write operations (POST create, PUT, DELETE) - allowed only if explicitly listed
 *
 * Path patterns use OpenAPI-style templates (e.g. {notebook_id}).
 * At build time, non-allowed write endpoints are stripped from the spec.
 * At runtime, the execute tool checks against these rules as a second guard.
 */

interface AllowlistEntry {
  readonly method: string;
  readonly path: string;
}

const WRITE_ALLOWLIST: readonly AllowlistEntry[] = [
  // Notebooks
  { method: "POST", path: "/api/v1/notebooks" },
  { method: "PUT", path: "/api/v1/notebooks/{notebook_id}" },
  { method: "DELETE", path: "/api/v1/notebooks/{notebook_id}" },
  // Dashboards
  { method: "POST", path: "/api/v1/dashboard" },
  { method: "PUT", path: "/api/v1/dashboard/{dashboard_id}" },
  { method: "DELETE", path: "/api/v1/dashboard/{dashboard_id}" },
] as const;

/**
 * POST path suffixes that indicate read-only query operations.
 * Many Datadog API endpoints use POST for complex search/query bodies
 * but are functionally reads.
 */
const SAFE_POST_SUFFIXES: readonly string[] = [
  "/search",
  "/aggregate",
  "/analytics",
  "/query",
  "/estimate",
] as const;

const READ_METHODS = new Set(["GET", "HEAD"]);

function isSafePost(method: string, path: string): boolean {
  return (
    method === "POST" &&
    SAFE_POST_SUFFIXES.some((suffix) => path.endsWith(suffix))
  );
}

/**
 * Check if a build-time spec method+path should be kept.
 * Keeps all reads, safe POST queries, and allowlisted writes.
 */
export function isAllowedSpecEndpoint(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  if (READ_METHODS.has(upper)) return true;
  if (isSafePost(upper, path)) return true;
  return WRITE_ALLOWLIST.some((e) => e.method === upper && e.path === path);
}

/**
 * Runtime guard for the execute tool. Matches a concrete request path
 * (e.g. /api/v1/notebooks/12345) against allowlist patterns.
 */
export function isAllowedRuntimeRequest(
  method: string,
  path: string,
): boolean {
  const upper = method.toUpperCase();
  if (READ_METHODS.has(upper)) return true;
  if (isSafePost(upper, path)) return true;
  return WRITE_ALLOWLIST.some(
    (e) => e.method === upper && matchPathPattern(e.path, path),
  );
}

/**
 * Match a concrete path against an OpenAPI pattern.
 * Pattern segments wrapped in {} match any non-empty segment.
 */
function matchPathPattern(pattern: string, concrete: string): boolean {
  const patternParts = pattern.split("/");
  const concreteParts = concrete.split("/");
  if (patternParts.length !== concreteParts.length) return false;
  return patternParts.every((pat, i) => {
    if (pat.startsWith("{") && pat.endsWith("}")) {
      return concreteParts[i].length > 0;
    }
    return pat === concreteParts[i];
  });
}
