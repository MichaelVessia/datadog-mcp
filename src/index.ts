import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";
import { ensureSpec } from "./ensure-spec";

await ensureSpec();

const apiKey = process.env.DD_API_KEY;
const appKey = process.env.DD_APP_KEY;
const site = process.env.DD_SITE ?? "datadoghq.com";

if (!apiKey || !appKey) {
  console.error(
    "Warning: DD_API_KEY and/or DD_APP_KEY not set. The search tool will work, but execute will fail.",
  );
}

const server = createServer({ apiKey, appKey, site });
const transport = new StdioServerTransport();
await server.connect(transport);
