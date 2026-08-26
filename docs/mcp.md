# The MCP server

```bash
bun mcp
```

OpenCommerce speaks [MCP](https://modelcontextprotocol.io), so any assistant
that speaks it — Claude Code, Claude Desktop, Cursor, Zed, Continue — can drive
the catalogue and extend the codebase.

There is still no AI **in** OpenCommerce. No model is called, no key is stored,
no provider is chosen. This server publishes what the system can already do and
lets whatever assistant you already pay for be the intelligence. That is the
whole point of the seam: the AI dependency count stays at zero, permanently.

---

## Connecting it

The server talks JSON-RPC over stdio. It needs no port, no daemon and no
config file of its own — your client starts it.

**Claude Code**

```bash
claude mcp add opencommerce -- bun src/mcp.ts
```

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opencommerce": {
      "command": "bun",
      "args": ["src/mcp.ts"],
      "cwd": "/absolute/path/to/opencommerce"
    }
  }
}
```

**Cursor** — the same object in `.cursor/mcp.json`.

Run `bun seed` first if you want a catalogue to look at. Without it every tool
will politely tell you the database is empty.

---

## What it exposes

Fourteen tools, in two families.

### Operate

| Tool | What it answers |
| --- | --- |
| `describe_opencommerce` | What is this, what is the canonical model, where are the seams |
| `list_connectors` | Every marketplace and social channel in the registry |
| `get_connector` | One connector's full manifest — auth, capabilities, required fields |
| `list_products` · `get_product` | The catalogue; `get_product` returns the exact shape a connector receives |
| `create_or_update_product` | Write a product. Saving queues a sync to every channel that can take it |
| `validate_product` | **Why is this not listing** — missing required fields, per channel |
| `list_channels` | Connected channels, health, mock or live, how much is listed |
| `sync_product` | Queue a sync. Live channels require explicit confirmation |
| `list_jobs` · `retry_job` | What failed, why, and put it back on the queue |
| `list_orders` | Orders imported from the channels |

### Extend

| Tool | What it gives you |
| --- | --- |
| `connector_sdk` | The contract: the interface, the manifest shape, the error taxonomy, and the rules that are not obvious from the types |
| `scaffold_connector` | A complete, compiling connector with working mock mode and honest TODOs, plus the exact registry edit |

---

## Adding a marketplace with an assistant

Adding a channel is two files: a connector, and one line in the registry. The
two extension tools exist to make that a change someone can make without having
read the codebase first.

A session looks like this:

> **You:** Add a Shopee connector.
>
> **Assistant** calls `connector_sdk` to learn the contract, then
> `scaffold_connector` with `name: "shopee"`, writes
> `src/lib/server/connectors/shopee.ts`, edits the registry, and runs
> `bun test`.

The scaffold is not a sketch. It compiles, it registers, and it passes the
self-test's manifest assertions as generated — the mock path is complete, so
the new channel is demonstrable before you have credentials for it. What it
cannot know is the marketplace's real endpoints and real required fields, and
it says so in TODOs rather than guessing.

Two things to hold your assistant to:

- **`requiredFields` must be honest.** It is what the product form renders and
  what the planner validates before queueing. Padding it blocks listings;
  understating it produces failed jobs instead of a visible `INCOMPLETE`.
- **Say whether the API was verified.** Three of the current connectors were
  written against documentation anyone can read. The rest say out loud that
  they were not. A new one should be equally clear about which it is.

If `bun test` fails with `<name>: complete product passes`, the new connector
requires an attribute the shared fixture does not have — add it to
`COMPLETE_ATTRIBUTES` in `src/lib/server/fixtures.ts`.

---

## What it will not do

**It never reads stored channel credentials.** No tool returns them, and none
reads the table they live in. `bun test` greps this server for the same SQL
patterns it greps the API routes for, so the guarantee is structural rather
than a promise. An assistant is a worse place to leak a secret than a browser
is — it may quote it back, paste it into a file, or hand it to another tool.

**It will not publish to a real marketplace on its own.** Channels in mock mode
sync freely. If any channel is in **live** mode, `sync_product` refuses and
names the channels, and only proceeds when called again with
`confirmLive: true`. An assistant that misreads an instruction should not be
able to push your catalogue to Amazon by itself.

**It does not write source files.** `scaffold_connector` returns text. Your
assistant already has editor tools and should use them, so that every file
written to your repo goes through the same review path as anything else it
writes.

**It does not run the worker.** Queueing a sync is not executing it — jobs run
under `bun dev`. That split is deliberate: an assistant can safely queue work
and inspect the results without a background process starting up inside your
editor.

---

## Notes

- The protocol is implemented directly rather than via the official SDK: MCP
  over stdio is newline-delimited JSON-RPC with five methods that matter, and
  the whole transport is the last eighty lines of `src/mcp.ts`. Swapping in
  `@modelcontextprotocol/sdk` would touch only that section — the tool
  definitions above it know nothing about the transport.
- Diagnostics go to **stderr**. stdout is the protocol; anything else printed
  there corrupts the session.
- The server resolves the single store the tenancy model allows today. When
  multi-store lands, the tools grow a `storeId` argument and nothing else
  changes.
