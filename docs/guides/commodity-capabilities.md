# Built-in Capabilities

Forge ships a set of "commodity" agent capabilities as built-in MCP servers so a
fresh install is useful out of the box, without hand-editing any config file.
They are seeded on first run in
[`runBackendMigrations.ts`](../../packages/desktop/src/process/utils/runBackendMigrations.ts)
(`buildDefaultMcpServers()`), from the shared descriptors in
[`builtinCapabilities.ts`](../../packages/desktop/src/common/config/builtinCapabilities.ts).

Seeding is idempotent: servers are added only if a server of the same name does
not already exist, so existing installs keep their own choices and edits are
never overwritten.

> **Runtime requirement:** these servers run via `npx`, so Node.js / `npx` must be
> available on the machine. The first run of each server downloads its package.
> Missing `npx` degrades gracefully (the server simply fails to connect) — it does
> not crash the app.

## Tier 1 — on by default (no key)

| Capability           | Server                                | Default                   |
| -------------------- | ------------------------------------- | ------------------------- |
| **Long-term memory** | `@modelcontextprotocol/server-memory` | Enabled                   |
| **Web browse**       | bundled `chrome-devtools-mcp`         | Enabled on fresh installs |

- **Memory** gives agents a cross-chat knowledge graph.
- **Web browse** reuses the already-bundled `chrome-devtools` server (navigate and
  read pages). It is enabled by default **only on fresh installs**; existing
  installs keep whatever state they already had, so upgrading never changes a
  user's current choice.

## Tier 2 — key-gated (enable in Settings)

These are seeded but **disabled**, with empty credentials. Enable them in
**Settings → Tools → Capabilities** by entering a key/connection string:

| Capability              | Server                                  | Credential                                             |
| ----------------------- | --------------------------------------- | ------------------------------------------------------ |
| **Web search (Tavily)** | `tavily-mcp`                            | Tavily API key (`TAVILY_API_KEY`)                      |
| **GitHub**              | `@modelcontextprotocol/server-github`   | Personal access token (`GITHUB_PERSONAL_ACCESS_TOKEN`) |
| **Postgres**            | `@modelcontextprotocol/server-postgres` | Connection string (positional argument)                |

The Capabilities section writes the credential into the built-in server's stdio
transport (`env` for API keys, a trailing argument for the Postgres connection
string) and enables the server. A capability cannot be enabled until a credential
is present; clearing the credential disables it again.

### Where credentials are stored

Credentials are persisted by the AionCore backend (the same trust boundary as
provider API keys) and are **never** written to this repository or to a
plaintext config file that ships with the app. Do not hardcode keys anywhere in
source.

> **Note on the GitHub server:** `@modelcontextprotocol/server-github` is the
> archived reference server; it still works with a personal access token. GitHub
> also offers a hosted remote MCP server as an alternative if you prefer not to
> run the npm package locally.

## Backlog (not shipped yet)

- **Google Drive / Sheets** (`@modelcontextprotocol/server-gdrive`) — requires a
  Google OAuth flow.
- **Playwright** (`@playwright/mcp`) — full browser automation (act on sites, not
  just read them).
- **OpenCode ACP agent wiring** — making the optional OpenCode agent consume these
  capabilities (the app does not manage OpenCode config today).
