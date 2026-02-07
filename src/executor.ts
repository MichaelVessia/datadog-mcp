import { isAllowedRuntimeRequest } from "./allowlist";

interface DatadogRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

interface DatadogConfig {
  apiKey: string;
  appKey: string;
  site: string;
}

/**
 * Execute user-provided JS code that searches the OpenAPI spec.
 * The code receives `spec` as a bound variable.
 */
export async function executeSearch(
  code: string,
  spec: unknown,
): Promise<unknown> {
  const AsyncFunction = async function () {}.constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction("spec", `return await (${code})()`);
  return fn(spec);
}

/**
 * Execute user-provided JS code that calls the Datadog API.
 * The code receives `datadog` as a bound variable with a `request()` method.
 */
export async function executeCode(
  code: string,
  config: DatadogConfig,
): Promise<unknown> {
  const datadog = {
    async request(options: DatadogRequestOptions): Promise<unknown> {
      const { method, path, query, body } = options;

      if (!isAllowedRuntimeRequest(method, path)) {
        throw new Error(
          `Blocked: ${method} ${path} is not in the write allowlist. Only GET/HEAD and specific notebook/dashboard operations are permitted.`,
        );
      }

      const url = new URL(`https://api.${config.site}${path}`);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined) {
            url.searchParams.set(key, String(value));
          }
        }
      }

      const headers: Record<string, string> = {
        "DD-API-KEY": config.apiKey,
        "DD-APPLICATION-KEY": config.appKey,
      };

      let requestBody: string | undefined;
      if (body) {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const response = await fetch(url.toString(), {
          method,
          headers,
          body: requestBody,
          signal: controller.signal,
        });

        const responseContentType =
          response.headers.get("content-type") ?? "";

        if (!response.ok) {
          let errorBody: string;
          try {
            errorBody = await response.text();
          } catch {
            errorBody = "(could not read error body)";
          }

          const rateLimitReset = response.headers.get("x-ratelimit-reset");
          const rateLimitMsg =
            response.status === 429 && rateLimitReset
              ? ` Rate limit resets in ${rateLimitReset}s.`
              : "";

          throw new Error(
            `Datadog API error ${response.status}: ${errorBody}${rateLimitMsg}`,
          );
        }

        if (responseContentType.includes("application/json")) {
          return response.json();
        }
        return response.text();
      } finally {
        clearTimeout(timeout);
      }
    },
  };

  const AsyncFunction = async function () {}.constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction("datadog", `return await (${code})()`);
  return fn(datadog);
}
