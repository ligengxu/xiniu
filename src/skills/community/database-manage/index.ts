import { z } from "zod";
import type { SkillDefinition } from "../types";
import * as path from "path";
import * as fs from "fs";
import {
  saveCredential, getCredential, listCredentials, deleteCredential, touchCredential, maskPassword,
} from "@/lib/credential-store";

const DESKTOP = "C:\\Users\\Administrator\\Desktop";

function ensureOutputDir(): string {
  const dir = path.join(DESKTOP, "output-database");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface DbConnection {
  type: "mysql" | "postgresql" | "sqlite";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  filePath?: string;
}

const DEFAULT_PORTS: Record<string, number> = { mysql: 3306, postgresql: 5432 };

function buildCredKey(conn: DbConnection): string {
  if (conn.type === "sqlite") return `db_sqlite_${path.basename(conn.filePath || conn.database)}`;
  return `db_${conn.type}_${conn.user || "root"}@${conn.host || "localhost"}:${conn.port || DEFAULT_PORTS[conn.type]}/${conn.database}`;
}

async function saveDbCredential(conn: DbConnection): Promise<void> {
  const key = buildCredKey(conn);
  await saveCredential(key, {
    type: conn.type,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    filePath: conn.filePath,
  });
}

async function findSavedCredential(): Promise<DbConnection | null> {
  const creds = await listCredentials();
  const dbCred = creds.find(c => c.key.startsWith("db_"));
  if (!dbCred) return null;
  const data = await getCredential(dbCred.key);
  if (!data) return null;
  return data as unknown as DbConnection;
}

async function executeSqlite(dbPath: string, sql: string): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; changes: number }> {
  const betterSqlite3 = await import("better-sqlite3");
  const Database = betterSqlite3.default;
  const db = new Database(dbPath);

  try {
    const trimmedSql = sql.trim().toUpperCase();
    const isSelect = trimmedSql.startsWith("SELECT") || trimmedSql.startsWith("PRAGMA") || trimmedSql.startsWith("EXPLAIN");

    if (isSelect) {
      const stmt = db.prepare(sql);
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return {
        columns,
        rows: rows.map(r => columns.map(c => r[c])),
        rowCount: rows.length,
        changes: 0,
      };
    } else {
      const result = db.exec(sql);
      void result;
      const info = db.prepare("SELECT changes() as c").get() as { c: number };
      return { columns: [], rows: [], rowCount: 0, changes: info.c };
    }
  } finally {
    db.close();
  }
}

async function executeMysql(conn: DbConnection, sql: string): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; changes: number }> {
  const mysql2 = await import("mysql2/promise");
  const connection = await mysql2.default.createConnection({
    host: conn.host || "localhost",
    port: conn.port || 3306,
    user: conn.user || "root",
    password: conn.password || "",
    database: conn.database,
    connectTimeout: 10000,
  });

  try {
    const [result, fields] = await connection.execute(sql);

    if (Array.isArray(result) && fields) {
      const columns = (fields as Array<{ name: string }>).map(f => f.name);
      const rows = (result as Record<string, unknown>[]).map(r => columns.map(c => r[c]));
      return { columns, rows, rowCount: rows.length, changes: 0 };
    } else {
      const r = result as { affectedRows?: number };
      return { columns: [], rows: [], rowCount: 0, changes: r.affectedRows || 0 };
    }
  } finally {
    await connection.end();
  }
}

async function executePostgresql(conn: DbConnection, sql: string): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; changes: number }> {
  const pg = await import("pg");
  const client = new pg.default.Client({
    host: conn.host || "localhost",
    port: conn.port || 5432,
    user: conn.user || "postgres",
    password: conn.password || "",
    database: conn.database,
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    const result = await client.query(sql);
    const columns = result.fields?.map((f: { name: string }) => f.name) || [];
    const rows = result.rows?.map((r: Record<string, unknown>) => columns.map(c => r[c])) || [];
    return { columns, rows, rowCount: result.rowCount || rows.length, changes: result.rowCount || 0 };
  } finally {
    await client.end();
  }
}

async function executeQuery(conn: DbConnection, sql: string) {
  switch (conn.type) {
    case "sqlite": return executeSqlite(conn.filePath || conn.database, sql);
    case "mysql": return executeMysql(conn, sql);
    case "postgresql": return executePostgresql(conn, sql);
    default: throw new Error(`不支持的数据库类型: ${conn.type}`);
  }
}

function formatTable(columns: string[], rows: unknown[][], maxRows = 50): string {
  if (columns.length === 0 || rows.length === 0) return "(无数据)";

  const display = rows.slice(0, maxRows);
  const widths = columns.map((c, i) => {
    const vals = display.map(r => String(r[i] ?? "NULL"));
    return Math.min(40, Math.max(c.length, ...vals.map(v => v.length)));
  });

  const header = columns.map((c, i) => c.padEnd(widths[i])).join(" | ");
  const sep = widths.map(w => "─".repeat(w)).join("─┼─");
  const body = display.map(r =>
    r.map((v, i) => String(v ?? "NULL").padEnd(widths[i])).join(" | ")
  ).join("\n");

  let table = `${header}\n${sep}\n${body}`;
  if (rows.length > maxRows) table += `\n... 共 ${rows.length} 行，显示前 ${maxRows} 行`;
  return table;
}

function parseConnection(params: Record<string, unknown>): DbConnection {
  return {
    type: (params.dbType as "mysql" | "postgresql" | "sqlite") || "sqlite",
    host: params.host as string | undefined,
    port: params.port as number | undefined,
    user: params.user as string | undefined,
    password: params.password as string | undefined,
    database: params.database as string || "",
    filePath: params.filePath as string | undefined,
  };
}

export const databaseManageSkill: SkillDefinition = {
  name: "database_manage",
  displayName: "数据库管理",
  description: `数据库连接与管理工具。支持 MySQL、PostgreSQL、SQLite 三种数据库。可执行查询(query)、列出表(tables)、查看表结构(schema)、导出数据(export)、备份数据库(backup)、测试连接(test)、列出已保存的连接(list_saved)。用户说'数据库'、'SQL'、'查询'、'MySQL'、'PostgreSQL'、'SQLite'、'建表'、'数据库备份'、'导出数据'时使用。`,
  icon: "Database",
  category: "dev",
  parameters: z.object({
    action: z.enum(["query", "tables", "schema", "export", "backup", "test", "list_saved"]).describe("操作：query=执行SQL, tables=列出表, schema=查看表结构, export=导出数据, backup=备份, test=测试连接, list_saved=列出已保存的连接"),
    dbType: z.enum(["mysql", "postgresql", "sqlite"]).optional().describe("数据库类型，默认 sqlite"),
    host: z.string().optional().describe("数据库主机地址（mysql/postgresql），默认 localhost"),
    port: z.number().optional().describe("端口号（mysql默认3306，postgresql默认5432）"),
    user: z.string().optional().describe("用户名"),
    password: z.string().optional().describe("密码"),
    database: z.string().optional().describe("数据库名"),
    filePath: z.string().optional().describe("SQLite 文件路径"),
    sql: z.string().optional().describe("要执行的 SQL 语句（query 操作）"),
    table: z.string().optional().describe("表名（schema/export 操作）"),
    format: z.enum(["csv", "json", "sql"]).optional().describe("导出格式（export操作），默认 csv"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;

    try {
      if (action === "list_saved") {
        const creds = await listCredentials();
        const dbCreds = creds.filter(c => c.key.startsWith("db_"));
        if (dbCreds.length === 0) return { success: true, message: "📋 没有已保存的数据库连接" };

        const lines = [`📋 已保存的数据库连接 (${dbCreds.length}个)`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const c of dbCreds) {
          const data = await getCredential(c.key);
          if (data) {
            const d = data as unknown as DbConnection;
            const info = d.type === "sqlite"
              ? `SQLite: ${d.filePath || d.database}`
              : `${d.type}: ${d.user}@${d.host}:${d.port}/${d.database}`;
            lines.push(`  🔗 ${info}`);
          }
        }
        return { success: true, message: lines.join("\n") };
      }

      let conn: DbConnection;

      if (p.dbType || p.host || p.filePath || p.database) {
        conn = parseConnection(p);
      } else {
        const saved = await findSavedCredential();
        if (!saved) {
          return { success: false, message: "❌ 未提供数据库连接信息，也没有已保存的连接\n\n请提供：\n- SQLite: filePath 参数\n- MySQL: dbType='mysql', host, user, password, database\n- PostgreSQL: dbType='postgresql', host, user, password, database" };
        }
        conn = saved;
      }

      if (conn.type === "sqlite") {
        const dbPath = conn.filePath || conn.database;
        if (!dbPath) return { success: false, message: "❌ SQLite 需要 filePath 或 database 参数" };
      } else {
        if (!conn.database) return { success: false, message: "❌ 请提供 database 数据库名" };
      }

      if (action === "test") {
        try {
          if (conn.type === "sqlite") {
            const dbPath = conn.filePath || conn.database;
            if (!fs.existsSync(dbPath)) {
              return { success: true, message: `📁 SQLite 文件不存在，将在首次查询时创建: ${dbPath}` };
            }
            await executeSqlite(dbPath, "SELECT 1");
          } else {
            await executeQuery(conn, "SELECT 1");
          }
          await saveDbCredential(conn);
          const info = conn.type === "sqlite"
            ? `SQLite: ${conn.filePath || conn.database}`
            : `${conn.type}: ${conn.user}@${conn.host}:${conn.port}/${conn.database}`;
          return { success: true, message: `✅ 数据库连接成功\n━━━━━━━━━━━━━━━━━━━━\n🔗 ${info}\n💾 连接信息已保存` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
            const pkg = conn.type === "mysql" ? "mysql2" : conn.type === "postgresql" ? "pg" : "better-sqlite3";
            return { success: false, message: `❌ 缺少数据库驱动\n\n请安装: npm install ${pkg}` };
          }
          return { success: false, message: `❌ 连接失败: ${msg}` };
        }
      }

      if (action === "tables") {
        let sql: string;
        switch (conn.type) {
          case "sqlite": sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"; break;
          case "mysql": sql = "SHOW TABLES"; break;
          case "postgresql": sql = "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"; break;
        }
        const result = await executeQuery(conn, sql);
        await saveDbCredential(conn);

        const tables = result.rows.map(r => String(r[0]));
        const lines = [`📋 数据表列表 (${tables.length}个)`, `━━━━━━━━━━━━━━━━━━━━`];
        tables.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
        return { success: true, message: lines.join("\n"), data: { tables, count: tables.length } };
      }

      if (action === "schema") {
        const table = p.table as string;
        if (!table) return { success: false, message: "❌ 查看表结构需要 table 参数" };

        let sql: string;
        switch (conn.type) {
          case "sqlite": sql = `PRAGMA table_info('${table}')`; break;
          case "mysql": sql = `DESCRIBE \`${table}\``; break;
          case "postgresql": sql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`; break;
        }
        const result = await executeQuery(conn, sql);
        await saveDbCredential(conn);

        const lines = [`📐 表结构: ${table}`, `━━━━━━━━━━━━━━━━━━━━`, formatTable(result.columns, result.rows)];

        if (conn.type === "sqlite") {
          try {
            const idxResult = await executeSqlite(conn.filePath || conn.database, `PRAGMA index_list('${table}')`);
            if (idxResult.rows.length > 0) {
              lines.push(`\n📑 索引:`);
              for (const row of idxResult.rows) { lines.push(`  ${String(row[1])}`); }
            }
          } catch { /* ignore */ }
        }

        return { success: true, message: lines.join("\n"), data: { table, columns: result.columns, rows: result.rows } };
      }

      if (action === "query") {
        const sql = p.sql as string;
        if (!sql) return { success: false, message: "❌ 请提供 sql 参数" };

        const start = Date.now();
        const result = await executeQuery(conn, sql);
        const elapsed = Date.now() - start;
        await saveDbCredential(conn);

        const trimmedSql = sql.trim().toUpperCase();
        const isSelect = trimmedSql.startsWith("SELECT") || trimmedSql.startsWith("PRAGMA") || trimmedSql.startsWith("EXPLAIN") || trimmedSql.startsWith("SHOW") || trimmedSql.startsWith("DESCRIBE");

        if (isSelect) {
          const lines = [
            `📊 查询结果`,
            `━━━━━━━━━━━━━━━━━━━━`,
            formatTable(result.columns, result.rows),
            `\n⏱️ ${elapsed}ms | ${result.rowCount} 行`,
          ];
          return { success: true, message: lines.join("\n"), data: { columns: result.columns, rowCount: result.rowCount, elapsed } };
        } else {
          return { success: true, message: `✅ SQL 执行成功\n━━━━━━━━━━━━━━━━━━━━\n📝 影响行数: ${result.changes}\n⏱️ ${elapsed}ms` };
        }
      }

      if (action === "export") {
        const table = p.table as string;
        if (!table) return { success: false, message: "❌ 导出需要 table 参数" };
        const format = (p.format as string) || "csv";

        const result = await executeQuery(conn, `SELECT * FROM ${conn.type === "mysql" ? `\`${table}\`` : `"${table}"`}`);
        await saveDbCredential(conn);

        const outDir = ensureOutputDir();
        let outFile: string;
        let content: string;

        if (format === "csv") {
          outFile = path.join(outDir, `${table}.csv`);
          const csvLines = [result.columns.join(",")];
          for (const row of result.rows) {
            csvLines.push(row.map(v => {
              const s = String(v ?? "");
              return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(","));
          }
          content = csvLines.join("\n");
        } else if (format === "json") {
          outFile = path.join(outDir, `${table}.json`);
          const jsonRows = result.rows.map(r => {
            const obj: Record<string, unknown> = {};
            result.columns.forEach((c, i) => { obj[c] = r[i]; });
            return obj;
          });
          content = JSON.stringify(jsonRows, null, 2);
        } else {
          outFile = path.join(outDir, `${table}.sql`);
          const insertLines: string[] = [];
          for (const row of result.rows) {
            const vals = row.map(v => v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
            insertLines.push(`INSERT INTO ${table} (${result.columns.join(", ")}) VALUES (${vals.join(", ")});`);
          }
          content = insertLines.join("\n");
        }

        fs.writeFileSync(outFile, content, "utf-8");
        return {
          success: true,
          message: `📤 数据导出完成\n━━━━━━━━━━━━━━━━━━━━\n📋 表: ${table}\n📊 行数: ${result.rowCount}\n📁 文件: ${outFile}\n📦 格式: ${format}`,
        };
      }

      if (action === "backup") {
        if (conn.type === "sqlite") {
          const dbPath = conn.filePath || conn.database;
          if (!fs.existsSync(dbPath)) return { success: false, message: `❌ 数据库文件不存在: ${dbPath}` };

          const outDir = ensureOutputDir();
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const backupFile = path.join(outDir, `${path.basename(dbPath, path.extname(dbPath))}-backup-${ts}${path.extname(dbPath)}`);
          fs.copyFileSync(dbPath, backupFile);
          return { success: true, message: `💾 SQLite 备份完成\n━━━━━━━━━━━━━━━━━━━━\n📥 源文件: ${dbPath}\n📤 备份: ${backupFile}` };
        }

        if (conn.type === "mysql") {
          const { exec: execCb } = await import("child_process");
          const { promisify: pfy } = await import("util");
          const execP = pfy(execCb);
          const outDir = ensureOutputDir();
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const backupFile = path.join(outDir, `${conn.database}-backup-${ts}.sql`);

          try {
            const passArg = conn.password ? `-p"${conn.password}"` : "";
            await execP(
              `mysqldump -h ${conn.host || "localhost"} -P ${conn.port || 3306} -u ${conn.user || "root"} ${passArg} ${conn.database} > "${backupFile}"`,
              { timeout: 120000 },
            );
            return { success: true, message: `💾 MySQL 备份完成\n━━━━━━━━━━━━━━━━━━━━\n🗄️ 数据库: ${conn.database}\n📤 备份: ${backupFile}` };
          } catch (err) {
            return { success: false, message: `❌ mysqldump 失败: ${err instanceof Error ? err.message : String(err)}\n\n请确认 mysqldump 已安装并在 PATH 中` };
          }
        }

        if (conn.type === "postgresql") {
          const { exec: execCb } = await import("child_process");
          const { promisify: pfy } = await import("util");
          const execP = pfy(execCb);
          const outDir = ensureOutputDir();
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const backupFile = path.join(outDir, `${conn.database}-backup-${ts}.sql`);

          try {
            const env = { ...process.env, PGPASSWORD: conn.password || "" };
            await execP(
              `pg_dump -h ${conn.host || "localhost"} -p ${conn.port || 5432} -U ${conn.user || "postgres"} ${conn.database} > "${backupFile}"`,
              { timeout: 120000, env },
            );
            return { success: true, message: `💾 PostgreSQL 备份完成\n━━━━━━━━━━━━━━━━━━━━\n🗄️ 数据库: ${conn.database}\n📤 备份: ${backupFile}` };
          } catch (err) {
            return { success: false, message: `❌ pg_dump 失败: ${err instanceof Error ? err.message : String(err)}\n\n请确认 pg_dump 已安装并在 PATH 中` };
          }
        }

        return { success: false, message: `❌ 不支持的数据库类型备份: ${conn.type}` };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
        const type = (p.dbType as string) || "sqlite";
        const pkg = type === "mysql" ? "mysql2" : type === "postgresql" ? "pg" : "better-sqlite3";
        return { success: false, message: `❌ 缺少数据库驱动包\n\n请安装: npm install ${pkg}\n\n支持的驱动:\n- SQLite: better-sqlite3\n- MySQL: mysql2\n- PostgreSQL: pg` };
      }
      return { success: false, message: `❌ 数据库操作异常: ${msg}` };
    }
  },
};
