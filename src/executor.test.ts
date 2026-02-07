import { describe, expect, test } from "bun:test";
import { executeSearch, executeCode } from "./executor";

describe("executeSearch", () => {
  const spec = {
    paths: {
      "/api/v1/monitor": {
        get: {
          summary: "Get all monitor details",
          tags: ["Monitors"],
        },
      },
      "/api/v2/logs/events/search": {
        post: {
          summary: "Search logs",
          tags: ["Logs"],
        },
      },
    },
  };

  test("finds paths by tag", async () => {
    const code = `async () => {
      const results = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods)) {
          if (op.tags?.some(t => t === 'Monitors')) {
            results.push({ method, path });
          }
        }
      }
      return results;
    }`;
    const result = await executeSearch(code, spec);
    expect(result).toEqual([{ method: "get", path: "/api/v1/monitor" }]);
  });

  test("returns all paths", async () => {
    const code = `async () => Object.keys(spec.paths)`;
    const result = await executeSearch(code, spec);
    expect(result).toEqual(["/api/v1/monitor", "/api/v2/logs/events/search"]);
  });

  test("returns empty for no matches", async () => {
    const code = `async () => {
      return Object.entries(spec.paths).filter(([p]) => p.includes('nonexistent'));
    }`;
    const result = await executeSearch(code, spec);
    expect(result).toEqual([]);
  });

  test("throws on syntax errors", async () => {
    expect(executeSearch("async () => {{{", spec)).rejects.toThrow();
  });

  test("throws on runtime errors", async () => {
    const code = `async () => { throw new Error("boom"); }`;
    expect(executeSearch(code, spec)).rejects.toThrow("boom");
  });
});

describe("executeCode", () => {
  const config = {
    apiKey: "test-api-key",
    appKey: "test-app-key",
    site: "datadoghq.com",
  };

  test("blocks non-allowlisted write requests", async () => {
    const code = `async () => {
      return datadog.request({ method: "DELETE", path: "/api/v2/security_monitoring/rules/abc" });
    }`;
    expect(executeCode(code, config)).rejects.toThrow(
      "not in the write allowlist",
    );
  });

  test("blocks POST to non-allowlisted path", async () => {
    const code = `async () => {
      return datadog.request({ method: "POST", path: "/api/v1/monitor" });
    }`;
    expect(executeCode(code, config)).rejects.toThrow(
      "not in the write allowlist",
    );
  });

  test("allows GET requests (will fail on network but passes guard)", async () => {
    const code = `async () => {
      return datadog.request({ method: "GET", path: "/api/v1/monitor" });
    }`;
    // This will fail with a network error (no real DD server), but the
    // important thing is that the write guard does NOT block it.
    try {
      await executeCode(code, config);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain("not in the write allowlist");
    }
  });

  test("allows allowlisted POST requests (will fail on network but passes guard)", async () => {
    const code = `async () => {
      return datadog.request({ method: "POST", path: "/api/v1/notebooks" });
    }`;
    try {
      await executeCode(code, config);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain("not in the write allowlist");
    }
  });

  test("throws on syntax errors in user code", async () => {
    expect(executeCode("async () => {{{", config)).rejects.toThrow();
  });
});
