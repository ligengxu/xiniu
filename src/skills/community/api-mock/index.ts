import { z } from "zod";
import type { SkillDefinition } from "../types";

interface MockRoute {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  delay: number;
}

const mockRoutes: Map<string, MockRoute> = new Map();
let serverProcess: { pid: number; port: number } | null = null;

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()}:${path}`;
}

function generateServerScript(port: number, routes: MockRoute[]): string {
  const routeMap = routes.map((r) => ({
    method: r.method.toUpperCase(),
    path: r.path,
    status: r.status,
    headers: r.headers,
    body: r.body,
    delay: r.delay,
  }));

  return `
const http = require("http");
const routes = ${JSON.stringify(routeMap, null, 2)};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const method = req.method.toUpperCase();
  const route = routes.find(r => r.method === method && r.path === url.pathname);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (!route) { res.writeHead(404); res.end(JSON.stringify({error:"Not Found"})); return; }
  if (route.delay > 0) await new Promise(r => setTimeout(r, route.delay));
  for (const [k,v] of Object.entries(route.headers)) res.setHeader(k, v);
  res.writeHead(route.status);
  res.end(route.body);
});
server.listen(${port}, () => console.log("Mock server on port ${port}"));
`;
}

export const apiMockSkill: SkillDefinition = {
  name: "api_mock",
  displayName: "接口模拟服务",
  description:
    "创建HTTP接口模拟服务：定义Mock路由、启动服务器、管理模拟接口。" +
    "用户说'Mock接口'、'模拟API'、'接口模拟'、'api mock'、'mock server'时使用。",
  icon: "Server",
  category: "dev",
  parameters: z.object({
    action: z.enum(["add", "remove", "list", "start", "stop", "clear"]).describe("操作: add添加路由/remove删除/list查看/start启动/stop停止/clear清空"),
    method: z.string().optional().describe("HTTP方法: GET/POST/PUT/DELETE，默认GET"),
    path: z.string().optional().describe("路由路径，如/api/users"),
    status: z.number().optional().describe("响应状态码，默认200"),
    body: z.string().optional().describe("响应体内容（JSON字符串）"),
    headers: z.record(z.string()).optional().describe("自定义响应头"),
    delay: z.number().optional().describe("响应延迟毫秒数，默认0"),
    port: z.number().optional().describe("服务端口，默认8787"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;

    try {
      switch (action) {
        case "add": {
          if (!p.path) return { success: false, message: "❌ 请提供路由路径(path)" };
          const method = ((p.method as string) || "GET").toUpperCase();
          const route: MockRoute = {
            method,
            path: p.path as string,
            status: (p.status as number) || 200,
            headers: { "Content-Type": "application/json", ...((p.headers as Record<string, string>) || {}) },
            body: (p.body as string) || '{"message":"ok"}',
            delay: (p.delay as number) || 0,
          };
          const key = routeKey(method, route.path);
          mockRoutes.set(key, route);
          return {
            success: true,
            message: `✅ Mock路由已添加\n━━━━━━━━━━━━━━━━━━━━\n📍 ${method} ${route.path}\n📊 状态码: ${route.status}\n⏱️ 延迟: ${route.delay}ms\n📦 响应: ${route.body.slice(0, 100)}`,
          };
        }

        case "remove": {
          if (!p.path) return { success: false, message: "❌ 请提供路由路径(path)" };
          const method = ((p.method as string) || "GET").toUpperCase();
          const key = routeKey(method, p.path as string);
          if (mockRoutes.delete(key)) {
            return { success: true, message: `✅ 已删除路由: ${method} ${p.path}` };
          }
          return { success: false, message: `❌ 未找到路由: ${method} ${p.path}` };
        }

        case "list": {
          if (mockRoutes.size === 0) return { success: true, message: "📋 当前无Mock路由" };
          let msg = `📋 Mock路由列表\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const [, r] of mockRoutes) {
            msg += `• ${r.method} ${r.path} → ${r.status}${r.delay ? ` (${r.delay}ms延迟)` : ""}\n`;
          }
          msg += `\n📊 共 ${mockRoutes.size} 个路由`;
          if (serverProcess) msg += `\n🟢 服务运行中: http://127.0.0.1:${serverProcess.port}`;
          return { success: true, message: msg };
        }

        case "start": {
          if (serverProcess) return { success: false, message: `❌ 服务已在运行 (PID: ${serverProcess.pid}, 端口: ${serverProcess.port})` };
          if (mockRoutes.size === 0) return { success: false, message: "❌ 请先添加Mock路由" };
          const port = (p.port as number) || 8787;
          const script = generateServerScript(port, Array.from(mockRoutes.values()));
          const fs = await import("fs");
          const path = await import("path");
          const os = await import("os");
          const scriptPath = path.join(os.tmpdir(), `mock-server-${port}.js`);
          fs.writeFileSync(scriptPath, script);
          const { spawn } = await import("child_process");
          const child = spawn("node", [scriptPath], { detached: true, stdio: "ignore", windowsHide: true });
          child.unref();
          serverProcess = { pid: child.pid!, port };
          return {
            success: true,
            message: `🟢 Mock服务已启动\n━━━━━━━━━━━━━━━━━━━━\n📡 地址: http://127.0.0.1:${port}\n🔢 PID: ${child.pid}\n📋 路由数: ${mockRoutes.size}`,
            data: { pid: child.pid, port },
          };
        }

        case "stop": {
          if (!serverProcess) return { success: true, message: "ℹ️ 无运行中的Mock服务" };
          try { process.kill(serverProcess.pid); } catch { /* already exited */ }
          const info = `🔴 Mock服务已停止 (PID: ${serverProcess.pid})`;
          serverProcess = null;
          return { success: true, message: info };
        }

        case "clear": {
          mockRoutes.clear();
          return { success: true, message: "🗑️ 所有Mock路由已清空" };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `❌ 操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
