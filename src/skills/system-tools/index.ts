import { z } from "zod";
import os from "os";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { SkillDefinition } from "../types";

const execAsync = promisify(exec);

// ==================== 1. 系统信息 ====================

export const systemInfoSkill: SkillDefinition = {
  name: "system_info",
  displayName: "系统信息",
  description: "获取当前系统的详细信息：CPU型号/使用率、内存总量/可用、磁盘空间、操作系统版本、网络接口、运行时间等。",
  icon: "Monitor",
  category: "dev",
  parameters: z.object({
    section: z.enum(["all", "cpu", "memory", "disk", "network", "os"]).optional()
      .describe("要查看的信息类别，默认 all"),
  }),
  execute: async (params) => {
    const { section = "all" } = params as { section?: string };
    const info: Record<string, unknown> = {};

    if (section === "all" || section === "os") {
      info.os = {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        user: os.userInfo().username,
        homedir: os.homedir(),
        tmpdir: os.tmpdir(),
      };
    }

    if (section === "all" || section === "cpu") {
      const cpus = os.cpus();
      info.cpu = {
        model: cpus[0]?.model,
        cores: cpus.length,
        speed: `${cpus[0]?.speed}MHz`,
      };
    }

    if (section === "all" || section === "memory") {
      const total = os.totalmem();
      const free = os.freemem();
      info.memory = {
        total: `${(total / 1073741824).toFixed(1)}GB`,
        free: `${(free / 1073741824).toFixed(1)}GB`,
        used: `${((total - free) / 1073741824).toFixed(1)}GB`,
        usagePercent: `${(((total - free) / total) * 100).toFixed(1)}%`,
      };
    }

    if (section === "all" || section === "disk") {
      try {
        const { stdout } = await execAsync("wmic logicaldisk get size,freespace,caption /format:csv", { timeout: 5000 });
        const lines = stdout.trim().split("\n").filter((l) => l.includes(","));
        const disks = lines.slice(1).map((line) => {
          const parts = line.trim().split(",");
          const caption = parts[1];
          const free = parseInt(parts[2]) || 0;
          const size = parseInt(parts[3]) || 0;
          if (!size) return null;
          return { drive: caption, total: `${(size / 1073741824).toFixed(1)}GB`, free: `${(free / 1073741824).toFixed(1)}GB` };
        }).filter(Boolean);
        info.disk = disks;
      } catch {
        info.disk = "获取磁盘信息失败";
      }
    }

    if (section === "all" || section === "network") {
      const nets = os.networkInterfaces();
      const interfaces: Record<string, string[]> = {};
      for (const [name, addrs] of Object.entries(nets)) {
        if (!addrs) continue;
        interfaces[name] = addrs.filter((a) => !a.internal).map((a) => `${a.family}: ${a.address}`);
      }
      info.network = interfaces;
    }

    const text = Object.entries(info).map(([k, v]) =>
      `## ${k.toUpperCase()}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`
    ).join("\n\n");

    return { success: true, message: text, data: info };
  },
};

// ==================== 2. 剪贴板操作 ====================

export const clipboardSkill: SkillDefinition = {
  name: "clipboard",
  displayName: "剪贴板操作",
  description: "读取或写入系统剪贴板内容。可以获取当前剪贴板文本，或将指定文本复制到剪贴板。",
  icon: "ClipboardCopy",
  category: "dev",
  parameters: z.object({
    action: z.enum(["read", "write"]).describe("操作类型：read=读取剪贴板，write=写入剪贴板"),
    text: z.string().optional().describe("要写入剪贴板的文本（仅write时需要）"),
  }),
  execute: async (params) => {
    const { action, text } = params as { action: "read" | "write"; text?: string };
    try {
      if (action === "write") {
        if (!text) return { success: false, message: "写入剪贴板需要提供text参数" };
        await execAsync(`powershell -command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`);
        return { success: true, message: `已复制到剪贴板 (${text.length}字符)` };
      }
      const { stdout } = await execAsync('powershell -command "Get-Clipboard"', { timeout: 5000 });
      const content = stdout.trim();
      return { success: true, message: content || "(剪贴板为空)", data: { content } };
    } catch (err) {
      return { success: false, message: `剪贴板操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 3. 进程管理 ====================

export const processManagerSkill: SkillDefinition = {
  name: "process_manager",
  displayName: "进程管理",
  description: "列出系统正在运行的进程或终止指定进程。可按名称过滤，查看CPU/内存占用。",
  icon: "Activity",
  category: "dev",
  parameters: z.object({
    action: z.enum(["list", "kill"]).describe("操作：list=列出进程，kill=终止进程"),
    filter: z.string().optional().describe("进程名称过滤（list时），如 'node', 'chrome'"),
    pid: z.number().optional().describe("要终止的进程PID（kill时需要）"),
  }),
  execute: async (params) => {
    const { action, filter, pid } = params as { action: "list" | "kill"; filter?: string; pid?: number };
    try {
      if (action === "kill") {
        if (!pid) return { success: false, message: "终止进程需要提供pid" };
        await execAsync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
        return { success: true, message: `已终止进程 PID: ${pid}` };
      }
      const cmd = filter
        ? `powershell -command "Get-Process | Where-Object {$_.ProcessName -like '*${filter}*'} | Select-Object -First 30 Id,ProcessName,CPU,@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String"`
        : `powershell -command "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 Id,ProcessName,CPU,@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String"`;
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      return { success: true, message: stdout.trim() || "无匹配进程" };
    } catch (err) {
      return { success: false, message: `进程操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 4. 网络诊断 ====================

export const networkDiagSkill: SkillDefinition = {
  name: "network_diag",
  displayName: "网络诊断",
  description: "网络诊断工具：ping主机、检测端口连通性、DNS查询、获取公网IP。",
  icon: "Wifi",
  category: "dev",
  parameters: z.object({
    action: z.enum(["ping", "port", "dns", "public_ip"]).describe("诊断类型"),
    host: z.string().optional().describe("目标主机/域名（ping/port/dns时需要）"),
    port: z.number().optional().describe("目标端口（port检测时需要）"),
  }),
  execute: async (params) => {
    const { action, host, port } = params as { action: string; host?: string; port?: number };
    try {
      switch (action) {
        case "ping": {
          if (!host) return { success: false, message: "ping需要提供host" };
          const { stdout } = await execAsync(`ping -n 4 ${host}`, { timeout: 15000 });
          return { success: true, message: stdout.trim() };
        }
        case "port": {
          if (!host || !port) return { success: false, message: "端口检测需要host和port" };
          const cmd = `powershell -command "try { $c = New-Object System.Net.Sockets.TcpClient; $r = $c.BeginConnect('${host}', ${port}, $null, $null); $w = $r.AsyncWaitHandle.WaitOne(3000, $false); if($w) { $c.EndConnect($r); Write-Output 'OPEN' } else { Write-Output 'CLOSED/FILTERED' }; $c.Close() } catch { Write-Output 'CLOSED/REFUSED' }"`;
          const { stdout } = await execAsync(cmd, { timeout: 10000 });
          const status = stdout.trim();
          return { success: true, message: `${host}:${port} → ${status}`, data: { host, port, status } };
        }
        case "dns": {
          if (!host) return { success: false, message: "DNS查询需要提供host" };
          const { stdout } = await execAsync(`nslookup ${host}`, { timeout: 10000 });
          return { success: true, message: stdout.trim() };
        }
        case "public_ip": {
          const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
          const data = await res.json();
          return { success: true, message: `公网IP: ${data.ip}`, data };
        }
        default:
          return { success: false, message: `未知诊断类型: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `网络诊断失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 5. 文件搜索 ====================

export const fileSearchSkill: SkillDefinition = {
  name: "file_search",
  displayName: "文件搜索",
  description: "在指定目录中搜索文件。支持按文件名模式匹配、按扩展名过滤、按内容搜索（grep）。",
  icon: "FolderSearch",
  category: "office",
  parameters: z.object({
    directory: z.string().describe("搜索根目录"),
    pattern: z.string().optional().describe("文件名匹配模式（支持*通配符），如 '*.txt', 'report*'"),
    contentSearch: z.string().optional().describe("在文件内容中搜索的关键词"),
    maxDepth: z.number().optional().describe("最大搜索深度，默认3"),
    maxResults: z.number().optional().describe("最大结果数，默认50"),
  }),
  execute: async (params) => {
    const { directory, pattern, contentSearch, maxDepth = 3, maxResults = 50 } = params as {
      directory: string; pattern?: string; contentSearch?: string; maxDepth?: number; maxResults?: number;
    };

    const results: { path: string; size: number; modified: string }[] = [];

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth || results.length >= maxResults) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

          if (entry.isDirectory()) {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            if (pattern) {
              const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
              if (!regex.test(entry.name)) continue;
            }
            if (contentSearch) {
              try {
                const content = await fs.readFile(fullPath, "utf-8");
                if (!content.includes(contentSearch)) continue;
              } catch { continue; }
            }
            try {
              const stat = await fs.stat(fullPath);
              results.push({ path: fullPath, size: stat.size, modified: stat.mtime.toISOString() });
            } catch { /* skip */ }
          }
        }
      } catch { /* permission denied etc */ }
    }

    await walk(path.resolve(directory), 0);

    if (results.length === 0) {
      return { success: true, message: "未找到匹配的文件" };
    }

    const lines = results.map((r) => {
      const sizeStr = r.size > 1048576 ? `${(r.size / 1048576).toFixed(1)}MB` : `${(r.size / 1024).toFixed(1)}KB`;
      return `${r.path} (${sizeStr}, ${new Date(r.modified).toLocaleString("zh-CN")})`;
    });

    return {
      success: true,
      message: `找到 ${results.length} 个文件:\n\n${lines.join("\n")}`,
      data: { count: results.length, files: results },
    };
  },
};

// ==================== 6. 压缩解压 ====================

export const zipSkill: SkillDefinition = {
  name: "zip_files",
  displayName: "压缩解压",
  description: "将文件/文件夹压缩为ZIP，或解压ZIP文件。使用系统内置压缩能力，无需额外依赖。",
  icon: "Archive",
  category: "office",
  parameters: z.object({
    action: z.enum(["compress", "extract"]).describe("操作：compress=压缩，extract=解压"),
    source: z.string().describe("源路径（压缩时为文件/文件夹路径，解压时为ZIP文件路径）"),
    destination: z.string().describe("目标路径（压缩时为ZIP输出路径，解压时为输出目录）"),
  }),
  execute: async (params) => {
    const { action, source, destination } = params as { action: "compress" | "extract"; source: string; destination: string };
    try {
      const src = path.resolve(source);
      const dst = path.resolve(destination);

      if (action === "compress") {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        const cmd = `powershell -command "Compress-Archive -Path '${src}' -DestinationPath '${dst}' -Force"`;
        await execAsync(cmd, { timeout: 60000 });
        const stat = await fs.stat(dst);
        return { success: true, message: `已压缩: ${dst} (${(stat.size / 1024).toFixed(1)}KB)`, data: { path: dst, size: stat.size } };
      }

      await fs.mkdir(dst, { recursive: true });
      const cmd = `powershell -command "Expand-Archive -Path '${src}' -DestinationPath '${dst}' -Force"`;
      await execAsync(cmd, { timeout: 60000 });
      return { success: true, message: `已解压到: ${dst}`, data: { path: dst } };
    } catch (err) {
      return { success: false, message: `压缩/解压失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 7. HTTP请求 ====================

export const httpRequestSkill: SkillDefinition = {
  name: "http_request",
  displayName: "网络请求",
  description: "发送任意HTTP请求（GET/POST/PUT/DELETE），可设置请求头和请求体。用于API测试、数据获取、Webhook触发等。",
  icon: "Zap",
  category: "dev",
  parameters: z.object({
    url: z.string().describe("请求URL"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]).optional().describe("HTTP方法，默认GET"),
    headers: z.record(z.string(), z.string()).optional().describe("请求头键值对"),
    body: z.string().optional().describe("请求体（POST/PUT时使用），JSON字符串"),
    timeout: z.number().optional().describe("超时毫秒数，默认15000"),
  }),
  execute: async (params) => {
    const { url, method = "GET", headers = {}, body, timeout = 15000 } = params as {
      url: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number;
    };
    try {
      const init: RequestInit = {
        method,
        headers: { ...headers },
        signal: AbortSignal.timeout(timeout),
      };
      if (body && ["POST", "PUT", "PATCH"].includes(method)) {
        init.body = body;
        if (!headers["Content-Type"] && !headers["content-type"]) {
          (init.headers as Record<string, string>)["Content-Type"] = "application/json";
        }
      }

      const res = await fetch(url, init);
      const contentType = res.headers.get("content-type") || "";
      let responseBody: string;
      if (contentType.includes("json")) {
        const json = await res.json();
        responseBody = JSON.stringify(json, null, 2);
      } else {
        responseBody = (await res.text()).substring(0, 5000);
      }

      const headersOut: Record<string, string> = {};
      res.headers.forEach((v, k) => { headersOut[k] = v; });

      return {
        success: res.ok,
        message: `${method} ${url}\nStatus: ${res.status} ${res.statusText}\n\n${responseBody}`,
        data: { status: res.status, headers: headersOut, body: responseBody.substring(0, 2000) },
      };
    } catch (err) {
      return { success: false, message: `HTTP请求失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 8. JSON/CSV 数据处理 ====================

export const dataProcessorSkill: SkillDefinition = {
  name: "data_processor",
  displayName: "数据文件处理",
  description: "读取并分析JSON/CSV数据文件，支持统计、过滤、排序、格式转换。可处理本地文件或提供的原始数据。",
  icon: "FileSpreadsheet",
  category: "office",
  parameters: z.object({
    filePath: z.string().optional().describe("数据文件路径（.json 或 .csv）"),
    rawData: z.string().optional().describe("直接提供的原始数据（JSON或CSV文本）"),
    action: z.enum(["stats", "filter", "sort", "head", "convert"]).optional().describe("操作：stats=统计信息，filter=过滤，sort=排序，head=前N行，convert=转换格式。默认stats"),
    filterField: z.string().optional().describe("过滤字段名"),
    filterValue: z.string().optional().describe("过滤值"),
    sortField: z.string().optional().describe("排序字段名"),
    limit: z.number().optional().describe("限制输出行数，默认20"),
    outputFormat: z.enum(["json", "csv", "markdown"]).optional().describe("输出格式，默认markdown"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    let data: Record<string, unknown>[] = [];

    try {
      let rawText = p.rawData as string | undefined;
      if (!rawText && p.filePath) {
        rawText = await fs.readFile(path.resolve(p.filePath as string), "utf-8");
      }
      if (!rawText) return { success: false, message: "请提供 filePath 或 rawData" };

      rawText = rawText.trim();
      if (rawText.startsWith("[") || rawText.startsWith("{")) {
        const parsed = JSON.parse(rawText);
        data = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return { success: false, message: "CSV数据至少需要表头和一行数据" };
        const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, unknown> = {};
          headers.forEach((h, j) => { row[h] = vals[j] ?? ""; });
          data.push(row);
        }
      }
    } catch (err) {
      return { success: false, message: `数据解析失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (data.length === 0) return { success: true, message: "数据为空" };

    const action = (p.action as string) || "stats";
    const limit = (p.limit as number) || 20;

    if (action === "filter" && p.filterField && p.filterValue) {
      data = data.filter((row) => String(row[p.filterField as string]).includes(p.filterValue as string));
    }

    if (action === "sort" && p.sortField) {
      data.sort((a, b) => String(a[p.sortField as string]).localeCompare(String(b[p.sortField as string])));
    }

    if (action === "stats") {
      const fields = Object.keys(data[0]);
      const stats = `总行数: ${data.length}\n字段数: ${fields.length}\n字段: ${fields.join(", ")}\n\n前${Math.min(5, data.length)}行预览:\n${JSON.stringify(data.slice(0, 5), null, 2)}`;
      return { success: true, message: stats, data: { rowCount: data.length, fields } };
    }

    const output = data.slice(0, limit);
    const fmt = (p.outputFormat as string) || "markdown";

    if (fmt === "markdown" && output.length > 0) {
      const keys = Object.keys(output[0]);
      const header = `| ${keys.join(" | ")} |`;
      const sep = `| ${keys.map(() => "---").join(" | ")} |`;
      const rows = output.map((r) => `| ${keys.map((k) => String(r[k] ?? "")).join(" | ")} |`);
      return { success: true, message: [header, sep, ...rows].join("\n"), data: { count: output.length } };
    }

    return { success: true, message: JSON.stringify(output, null, 2), data: { count: output.length } };
  },
};

// ==================== 9. 环境变量管理 ====================

export const envManagerSkill: SkillDefinition = {
  name: "env_manager",
  displayName: "环境变量管理",
  description: "读取或临时设置环境变量。可列出所有环境变量、查询指定变量、或设置临时变量（仅当前进程生效）。",
  icon: "Settings",
  category: "dev",
  parameters: z.object({
    action: z.enum(["list", "get", "set"]).describe("操作：list=列出全部，get=查询指定变量，set=设置变量（仅当前进程）"),
    name: z.string().optional().describe("变量名（get/set时需要）"),
    value: z.string().optional().describe("变量值（set时需要）"),
    filter: z.string().optional().describe("过滤关键词（list时使用）"),
  }),
  execute: async (params) => {
    const { action, name, value, filter } = params as {
      action: "list" | "get" | "set"; name?: string; value?: string; filter?: string;
    };

    if (action === "set") {
      if (!name || value === undefined) return { success: false, message: "设置环境变量需要name和value" };
      process.env[name] = value;
      return { success: true, message: `已设置 ${name}=${value}（仅当前进程生效）` };
    }

    if (action === "get") {
      if (!name) return { success: false, message: "查询需要提供变量名" };
      const val = process.env[name];
      return { success: true, message: val !== undefined ? `${name}=${val}` : `变量 ${name} 未设置`, data: { name, value: val } };
    }

    const entries = Object.entries(process.env)
      .filter(([k]) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 50);

    const lines = entries.map(([k, v]) => `${k}=${(v || "").substring(0, 100)}`);
    return { success: true, message: `环境变量 (${entries.length}个):\n\n${lines.join("\n")}` };
  },
};

// ==================== 10. 文本差异比较 ====================

export const textDiffSkill: SkillDefinition = {
  name: "text_diff",
  displayName: "文本差异比较",
  description: "比较两段文本或两个文件的差异，输出逐行对比结果。可用于代码比对、文档版本对比、配置文件检查。",
  icon: "GitCompare",
  category: "dev",
  parameters: z.object({
    textA: z.string().optional().describe("第一段文本"),
    textB: z.string().optional().describe("第二段文本"),
    fileA: z.string().optional().describe("第一个文件路径（替代textA）"),
    fileB: z.string().optional().describe("第二个文件路径（替代textB）"),
  }),
  execute: async (params) => {
    const p = params as { textA?: string; textB?: string; fileA?: string; fileB?: string };

    let a = p.textA || "";
    let b = p.textB || "";

    try {
      if (p.fileA) a = await fs.readFile(path.resolve(p.fileA), "utf-8");
      if (p.fileB) b = await fs.readFile(path.resolve(p.fileB), "utf-8");
    } catch (err) {
      return { success: false, message: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!a && !b) return { success: false, message: "请提供 textA/textB 或 fileA/fileB" };

    const linesA = a.split("\n");
    const linesB = b.split("\n");
    const maxLen = Math.max(linesA.length, linesB.length);
    const diffs: string[] = [];
    let addCount = 0, removeCount = 0, sameCount = 0;

    for (let i = 0; i < maxLen; i++) {
      const la = linesA[i];
      const lb = linesB[i];
      if (la === lb) {
        sameCount++;
        if (diffs.length < 200) diffs.push(`  ${i + 1} | ${(la ?? "").substring(0, 120)}`);
      } else {
        if (la !== undefined) { removeCount++; if (diffs.length < 200) diffs.push(`- ${i + 1} | ${la.substring(0, 120)}`); }
        if (lb !== undefined) { addCount++; if (diffs.length < 200) diffs.push(`+ ${i + 1} | ${lb.substring(0, 120)}`); }
      }
    }

    const summary = `差异统计: ${addCount}行新增, ${removeCount}行删除, ${sameCount}行相同 (共${maxLen}行)`;
    return {
      success: true,
      message: `${summary}\n\n${diffs.join("\n")}`,
      data: { added: addCount, removed: removeCount, same: sameCount, totalLines: maxLen },
    };
  },
};
