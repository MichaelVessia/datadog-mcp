import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeSearch, executeCode } from "./executor";
import { truncateResponse } from "./truncate";
import { PRODUCTS } from "./data/products";

const SPEC_TYPES = `
interface OperationInfo {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: unknown; description?: string }>;
  requestBody?: { required?: boolean; content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
}

interface PathItem {
  get?: OperationInfo;
  post?: OperationInfo;
  put?: OperationInfo;
  patch?: OperationInfo;
  delete?: OperationInfo;
}

declare const spec: {
  paths: Record<string, PathItem>;
};
`;

const DATADOG_TYPES = `
interface DatadogRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

declare const datadog: {
  request(options: DatadogRequestOptions): Promise<unknown>;
};
`;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ServerConfig {
  apiKey: string | undefined;
  appKey: string | undefined;
  site: string;
}

export function createServer(config: ServerConfig): McpServer {
  const server = new McpServer({
    name: "datadog-api",
    version: "0.1.0",
  });

  // Load spec lazily to avoid blocking startup
  let specCache: unknown;
  function getSpec(): unknown {
    if (!specCache) {
      specCache = require("./data/spec.json");
    }
    return specCache;
  }

  server.registerTool(
    "search",
    {
      description: `Search the Datadog OpenAPI spec. All $refs are pre-resolved inline. Covers both v1 and v2 APIs.

Products: ${PRODUCTS.slice(0, 30).join(", ")}... (${PRODUCTS.length} total)

Types:
${SPEC_TYPES}

Examples:

// Find endpoints by product tag
async () => {
  const results = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.tags?.some(t => t.toLowerCase() === 'logs')) {
        results.push({ method: method.toUpperCase(), path, summary: op.summary });
      }
    }
  }
  return results;
}

// Get endpoint details with requestBody schema
async () => {
  const op = spec.paths['/api/v1/notebooks']?.post;
  return { summary: op?.summary, requestBody: op?.requestBody, parameters: op?.parameters };
}

// Search by keyword in summary/description
async () => {
  const results = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.summary?.toLowerCase().includes('monitor') || op.description?.toLowerCase().includes('monitor')) {
        results.push({ method: method.toUpperCase(), path, summary: op.summary });
      }
    }
  }
  return results;
}`,
      inputSchema: {
        code: z
          .string()
          .describe(
            "JavaScript async arrow function to search the OpenAPI spec",
          ),
      },
    },
    async ({ code }) => {
      try {
        const result = await executeSearch(code, getSpec());
        return {
          content: [{ type: "text" as const, text: truncateResponse(result) }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${formatError(error)}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "execute",
    {
      description: `Execute JavaScript code against the Datadog API. First use the 'search' tool to find the right endpoints, then write code using the datadog.request() function.

All GET requests are allowed. Write operations are restricted to notebooks and dashboards.

Available in your code:
${DATADOG_TYPES}

Your code must be an async arrow function that returns the result.

Examples:

// List monitors
async () => {
  return datadog.request({ method: "GET", path: "/api/v1/monitor" });
}

// Search logs
async () => {
  return datadog.request({
    method: "POST",
    path: "/api/v2/logs/events/search",
    body: { filter: { query: "service:web-app status:error", from: "now-1h", to: "now" }, page: { limit: 10 } }
  });
}

// Create a notebook
async () => {
  return datadog.request({
    method: "POST",
    path: "/api/v1/notebooks",
    body: { data: { type: "notebooks", attributes: { name: "Investigation", cells: [], time: { live_span: "1h" } } } }
  });
}`,
      inputSchema: {
        code: z
          .string()
          .describe("JavaScript async arrow function to execute"),
      },
    },
    async ({ code }) => {
      if (!config.apiKey || !config.appKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: DD_API_KEY and DD_APP_KEY environment variables are required for API execution.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await executeCode(code, {
          apiKey: config.apiKey,
          appKey: config.appKey,
          site: config.site,
        });
        return {
          content: [{ type: "text" as const, text: truncateResponse(result) }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${formatError(error)}` },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
