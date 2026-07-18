import { getDb } from "./connection";

export type McpTransportKind = "stdio" | "http";

export interface McpServerRow {
  id: string;
  name: string;
  transport: McpTransportKind;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface McpServerDbRow {
  id: string;
  name: string;
  transport: McpTransportKind;
  command: string | null;
  args: string | null;
  env: string | null;
  cwd: string | null;
  url: string | null;
  headers: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToMcpServer(r: McpServerDbRow): McpServerRow {
  return {
    id: r.id,
    name: r.name,
    transport: r.transport,
    command: r.command,
    args: r.args ? (JSON.parse(r.args) as string[]) : null,
    env: r.env ? (JSON.parse(r.env) as Record<string, string>) : null,
    cwd: r.cwd,
    url: r.url,
    headers: r.headers ? (JSON.parse(r.headers) as Record<string, string>) : null,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface McpServerInput {
  id: string;
  name: string;
  transport: McpTransportKind;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  cwd?: string | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

export function upsertMcpServer(input: McpServerInput): McpServerRow {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args, env, cwd, url, headers, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       transport=excluded.transport,
       command=excluded.command,
       args=excluded.args,
       env=excluded.env,
       cwd=excluded.cwd,
       url=excluded.url,
       headers=excluded.headers,
       enabled=excluded.enabled,
       updated_at=excluded.updated_at`,
  ).run(
    input.id,
    input.name,
    input.transport,
    input.command ?? null,
    input.args ? JSON.stringify(input.args) : null,
    input.env ? JSON.stringify(input.env) : null,
    input.cwd ?? null,
    input.url ?? null,
    input.headers ? JSON.stringify(input.headers) : null,
    input.enabled === false ? 0 : 1,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM mcp_servers WHERE id = ?`)
    .get(input.id) as McpServerDbRow;
  return rowToMcpServer(row);
}

export function getMcpServers(onlyEnabled: boolean = false): McpServerRow[] {
  const db = getDb();
  const rows = (
    onlyEnabled
      ? db.prepare(`SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name`).all()
      : db.prepare(`SELECT * FROM mcp_servers ORDER BY name`).all()
  ) as McpServerDbRow[];
  return rows.map(rowToMcpServer);
}

export function getMcpServer(id: string): McpServerRow | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM mcp_servers WHERE id = ?`)
    .get(id) as McpServerDbRow | undefined;
  return row ? rowToMcpServer(row) : undefined;
}

export function deleteMcpServer(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(id);
}
