import { describe, expect, test } from "bun:test";
import { isAllowedSpecEndpoint, isAllowedRuntimeRequest } from "./allowlist";

describe("isAllowedSpecEndpoint", () => {
  test("allows all GET requests", () => {
    expect(isAllowedSpecEndpoint("get", "/api/v1/monitor")).toBe(true);
    expect(isAllowedSpecEndpoint("GET", "/api/v2/logs/events/search")).toBe(
      true,
    );
  });

  test("allows all HEAD requests", () => {
    expect(isAllowedSpecEndpoint("head", "/api/v1/anything")).toBe(true);
    expect(isAllowedSpecEndpoint("HEAD", "/api/v2/anything")).toBe(true);
  });

  test("allows allowlisted POST endpoints", () => {
    expect(isAllowedSpecEndpoint("POST", "/api/v1/notebooks")).toBe(true);
    expect(isAllowedSpecEndpoint("post", "/api/v1/dashboard")).toBe(true);
  });

  test("allows allowlisted PUT endpoints", () => {
    expect(
      isAllowedSpecEndpoint("PUT", "/api/v1/notebooks/{notebook_id}"),
    ).toBe(true);
    expect(
      isAllowedSpecEndpoint("PUT", "/api/v1/dashboard/{dashboard_id}"),
    ).toBe(true);
  });

  test("allows allowlisted DELETE endpoints", () => {
    expect(
      isAllowedSpecEndpoint("DELETE", "/api/v1/notebooks/{notebook_id}"),
    ).toBe(true);
    expect(
      isAllowedSpecEndpoint("DELETE", "/api/v1/dashboard/{dashboard_id}"),
    ).toBe(true);
  });

  test("blocks non-allowlisted POST endpoints", () => {
    expect(isAllowedSpecEndpoint("POST", "/api/v1/monitor")).toBe(false);
    expect(
      isAllowedSpecEndpoint("POST", "/api/v2/security_monitoring/rules"),
    ).toBe(false);
  });

  test("blocks non-allowlisted DELETE endpoints", () => {
    expect(
      isAllowedSpecEndpoint("DELETE", "/api/v2/security_monitoring/rules/{id}"),
    ).toBe(false);
    expect(isAllowedSpecEndpoint("DELETE", "/api/v1/monitor/{monitor_id}")).toBe(
      false,
    );
  });

  test("blocks non-allowlisted PATCH endpoints", () => {
    expect(isAllowedSpecEndpoint("PATCH", "/api/v2/incidents/{id}")).toBe(
      false,
    );
  });
});

describe("isAllowedRuntimeRequest", () => {
  test("allows GET requests with concrete paths", () => {
    expect(isAllowedRuntimeRequest("GET", "/api/v1/monitor")).toBe(true);
    expect(
      isAllowedRuntimeRequest("GET", "/api/v2/logs/events/search"),
    ).toBe(true);
  });

  test("allows allowlisted POST with concrete paths", () => {
    expect(isAllowedRuntimeRequest("POST", "/api/v1/notebooks")).toBe(true);
    expect(isAllowedRuntimeRequest("POST", "/api/v1/dashboard")).toBe(true);
  });

  test("allows allowlisted PUT with concrete path params", () => {
    expect(isAllowedRuntimeRequest("PUT", "/api/v1/notebooks/12345")).toBe(
      true,
    );
    expect(isAllowedRuntimeRequest("PUT", "/api/v1/dashboard/abc-def")).toBe(
      true,
    );
  });

  test("allows allowlisted DELETE with concrete path params", () => {
    expect(isAllowedRuntimeRequest("DELETE", "/api/v1/notebooks/99")).toBe(
      true,
    );
    expect(
      isAllowedRuntimeRequest("DELETE", "/api/v1/dashboard/dash-123"),
    ).toBe(true);
  });

  test("blocks non-allowlisted writes with concrete paths", () => {
    expect(isAllowedRuntimeRequest("POST", "/api/v1/monitor")).toBe(false);
    expect(
      isAllowedRuntimeRequest("DELETE", "/api/v2/security_monitoring/rules/abc"),
    ).toBe(false);
    expect(isAllowedRuntimeRequest("PUT", "/api/v1/monitor/123")).toBe(false);
  });

  test("blocks writes with extra path segments", () => {
    expect(
      isAllowedRuntimeRequest("PUT", "/api/v1/notebooks/123/extra"),
    ).toBe(false);
  });

  test("blocks writes with missing path segments", () => {
    expect(isAllowedRuntimeRequest("DELETE", "/api/v1/notebooks")).toBe(false);
  });
});
