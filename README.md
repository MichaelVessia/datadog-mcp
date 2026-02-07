# datadog-mcp

Local MCP server that lets Claude interact with the Datadog API using the "codemode" pattern. The full OpenAPI spec (11MB, 475 endpoints) lives on the server. Claude writes small JS functions that run against it, keeping the conversation context small.

## How it works

Two tools:

- **search** - Claude writes JS to query the OpenAPI spec and discover endpoints, schemas, parameters
- **execute** - Claude writes JS to make authenticated Datadog API calls via `datadog.request()`

All GET requests are allowed. Writes are restricted to notebooks and dashboards.

## Setup

```bash
# Install dependencies
bun install

# Build the spec (fetches v1 + v2 from GitHub, resolves $refs, filters)
bun run build:spec

# Add to Claude Code
claude mcp add datadog-mcp \
  -e DD_API_KEY=your-api-key \
  -e DD_APP_KEY=your-app-key \
  -- bun run /path/to/datadog-mcp/src/index.ts
```

`DD_SITE` defaults to `datadoghq.com`. Set it if you use a different region (e.g. `datadoghq.eu`).

## Examples

Once added, just talk to Claude naturally:

> "Show me error logs from the web-app service in the last hour"

Claude will search the spec, find the logs endpoint, then execute:

```js
async () => {
  return datadog.request({
    method: "POST",
    path: "/api/v2/logs/events/search",
    body: {
      filter: { query: "service:web-app status:error", from: "now-1h", to: "now" },
      page: { limit: 10 }
    }
  });
}
```

> "List all monitors that are in an alert state"

```js
async () => {
  return datadog.request({
    method: "GET",
    path: "/api/v1/monitor",
    query: { monitor_tags: "status:alert" }
  });
}
```

> "Create a notebook for investigating the checkout latency spike"

```js
async () => {
  return datadog.request({
    method: "POST",
    path: "/api/v1/notebooks",
    body: {
      data: {
        type: "notebooks",
        attributes: {
          name: "Checkout Latency Investigation",
          cells: [],
          time: { live_span: "4h" }
        }
      }
    }
  });
}
```

## Write allowlist

Only these write operations are permitted (everything else is blocked at both spec-level and runtime):

| Method | Path |
|--------|------|
| POST | `/api/v1/notebooks` |
| PUT/DELETE | `/api/v1/notebooks/{notebook_id}` |
| POST | `/api/v1/dashboard` |
| PUT/DELETE | `/api/v1/dashboard/{dashboard_id}` |

## Development

```bash
bun test        # Run tests
bun run typecheck  # Type check
bun run build:spec # Rebuild spec from upstream
```

## Testing with MCP Inspector

```bash
DD_API_KEY=xxx DD_APP_KEY=xxx bunx @modelcontextprotocol/inspector -- bun run src/index.ts
```
