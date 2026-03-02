import { z } from "zod";
import type { SkillDefinition } from "../types";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);
const TIMEOUT = 30000;
const DESKTOP = "C:\\Users\\Administrator\\Desktop";

async function docker(cmd: string, timeout = TIMEOUT): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`docker ${cmd}`, { timeout });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("is not recognized") || msg.includes("not found")) {
      return { ok: false, stdout: "", stderr: "Docker 未安装或不在 PATH 中。请安装 Docker Desktop: https://www.docker.com/products/docker-desktop" };
    }
    return { ok: false, stdout: "", stderr: msg.slice(0, 1000) };
  }
}

async function dockerCompose(cmd: string, cwd?: string, timeout = 60000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`docker compose ${cmd}`, { timeout, cwd });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch {
    try {
      const { stdout, stderr } = await execAsync(`docker-compose ${cmd}`, { timeout, cwd });
      return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err2) {
      return { ok: false, stdout: "", stderr: (err2 instanceof Error ? err2.message : String(err2)).slice(0, 1000) };
    }
  }
}

function parseContainerList(stdout: string): Record<string, string>[] {
  const lines = stdout.split("\n").filter(l => l.trim());
  if (lines.length === 0) return [];
  try {
    return lines.map(l => JSON.parse(l) as Record<string, string>);
  } catch {
    return lines.map(l => ({ raw: l }));
  }
}

function formatSize(bytes: number): string {
  if (bytes > 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + " GB";
  if (bytes > 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
}

export const dockerManageSkill: SkillDefinition = {
  name: "docker_manage",
  displayName: "容器管理",
  description: `Docker 容器和镜像管理工具。支持：列出容器(ps)、启动(start)、停止(stop)、重启(restart)、删除容器(rm)、查看日志(logs)、执行命令(exec)、列出镜像(images)、拉取镜像(pull)、删除镜像(rmi)、构建镜像(build)、系统信息(info)、清理(prune)、docker-compose操作(compose_up/compose_down/compose_ps)、导出容器(export)、容器详情(inspect)。用户说'docker'、'容器'、'镜像'、'docker-compose'、'容器管理'、'启动容器'、'停止容器'、'查看日志'时使用。`,
  icon: "Container",
  category: "dev",
  parameters: z.object({
    action: z.enum([
      "ps", "start", "stop", "restart", "rm", "logs", "exec",
      "images", "pull", "rmi", "build", "info", "prune",
      "compose_up", "compose_down", "compose_ps",
      "export", "inspect", "stats",
    ]).describe("操作类型"),
    container: z.string().optional().describe("容器名称或ID（ps/start/stop/restart/rm/logs/exec/export/inspect/stats）"),
    image: z.string().optional().describe("镜像名称:标签（pull/rmi/build）"),
    command: z.string().optional().describe("要在容器内执行的命令（exec）"),
    tail: z.number().optional().describe("日志尾行数（logs），默认100"),
    all: z.boolean().optional().describe("是否显示所有容器（ps），包括已停止的"),
    composePath: z.string().optional().describe("docker-compose.yml 文件路径（compose_*操作）"),
    buildContext: z.string().optional().describe("Dockerfile 所在目录（build操作）"),
    dockerfile: z.string().optional().describe("Dockerfile 文件名，默认 Dockerfile"),
    detach: z.boolean().optional().describe("是否后台运行（compose_up），默认true"),
    force: z.boolean().optional().describe("强制操作（rm/rmi/prune），默认false"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;

    try {
      if (action === "info") {
        const result = await docker("info --format '{{.ServerVersion}}\n{{.NCPU}}\n{{.MemTotal}}\n{{.ContainersRunning}}\n{{.ContainersStopped}}\n{{.Images}}'");
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };

        const infoResult = await docker("info");
        const lines = [`🐳 Docker 系统信息`, `━━━━━━━━━━━━━━━━━━━━`];

        const versionResult = await docker("version --format '{{.Server.Version}}'");
        if (versionResult.ok) lines.push(`📦 版本: ${versionResult.stdout.replace(/'/g, "")}`);

        const extract = (key: string, text: string): string => {
          const match = text.match(new RegExp(`${key}:\\s*(.+)`, "i"));
          return match ? match[1].trim() : "N/A";
        };
        const info = infoResult.stdout;
        lines.push(`🖥️ 运行容器: ${extract("Containers Running", info) || extract("Running", info)}`);
        lines.push(`⏹️ 停止容器: ${extract("Containers Stopped", info) || extract("Stopped", info)}`);
        lines.push(`📀 镜像数: ${extract("Images", info)}`);
        lines.push(`💽 存储驱动: ${extract("Storage Driver", info)}`);
        lines.push(`🌐 操作系统: ${extract("Operating System", info)}`);

        return { success: true, message: lines.join("\n") };
      }

      if (action === "ps") {
        const allFlag = p.all ? "-a" : "";
        const result = await docker(`ps ${allFlag} --format "{{json .}}"`);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };

        const containers = parseContainerList(result.stdout);
        if (containers.length === 0) return { success: true, message: `📋 没有${p.all ? "" : "运行中的"}容器` };

        const lines = [`🐳 容器列表 (${containers.length}个)`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const c of containers) {
          const status = c.Status || c.State || "";
          const icon = status.toLowerCase().includes("up") ? "🟢" : "🔴";
          lines.push(`${icon} ${c.Names || c.raw || "unknown"}`);
          if (c.Image) lines.push(`  📀 镜像: ${c.Image}`);
          if (c.Status) lines.push(`  📊 状态: ${c.Status}`);
          if (c.Ports) lines.push(`  🔌 端口: ${c.Ports}`);
          if (c.ID) lines.push(`  🔑 ID: ${c.ID.slice(0, 12)}`);
        }
        return { success: true, message: lines.join("\n"), data: { containers: containers.length } };
      }

      if (action === "start" || action === "stop" || action === "restart") {
        const container = p.container as string;
        if (!container) return { success: false, message: `❌ ${action} 需要 container 参数` };
        const result = await docker(`${action} ${container}`);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        const emoji = action === "start" ? "▶️" : action === "stop" ? "⏹️" : "🔄";
        return { success: true, message: `${emoji} 容器 ${container} 已${action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}` };
      }

      if (action === "rm") {
        const container = p.container as string;
        if (!container) return { success: false, message: "❌ rm 需要 container 参数" };
        const force = p.force ? "-f" : "";
        const result = await docker(`rm ${force} ${container}`);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🗑️ 容器 ${container} 已删除` };
      }

      if (action === "logs") {
        const container = p.container as string;
        if (!container) return { success: false, message: "❌ logs 需要 container 参数" };
        const tail = (p.tail as number) || 100;
        const result = await docker(`logs --tail ${tail} ${container}`, 15000);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        const logs = result.stdout || result.stderr || "(空日志)";
        return {
          success: true,
          message: `📋 容器 ${container} 日志 (最后${tail}行)\n━━━━━━━━━━━━━━━━━━━━\n${logs.slice(0, 5000)}`,
        };
      }

      if (action === "exec") {
        const container = p.container as string;
        const command = p.command as string;
        if (!container || !command) return { success: false, message: "❌ exec 需要 container + command 参数" };
        const result = await docker(`exec ${container} ${command}`, 30000);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `💻 执行结果:\n${result.stdout || "(无输出)"}` };
      }

      if (action === "images") {
        const result = await docker('images --format "{{json .}}"');
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        const images = parseContainerList(result.stdout);
        if (images.length === 0) return { success: true, message: "📋 没有本地镜像" };

        const lines = [`📀 镜像列表 (${images.length}个)`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const img of images) {
          lines.push(`📀 ${img.Repository || "none"}:${img.Tag || "latest"}`);
          if (img.Size) lines.push(`  💾 大小: ${img.Size}`);
          if (img.ID) lines.push(`  🔑 ID: ${img.ID.slice(0, 12)}`);
          if (img.CreatedSince) lines.push(`  📅 创建: ${img.CreatedSince}`);
        }
        return { success: true, message: lines.join("\n"), data: { images: images.length } };
      }

      if (action === "pull") {
        const image = p.image as string;
        if (!image) return { success: false, message: "❌ pull 需要 image 参数（如 nginx:latest）" };
        const result = await docker(`pull ${image}`, 120000);
        if (!result.ok) return { success: false, message: `❌ 拉取失败: ${result.stderr}` };
        return { success: true, message: `📥 镜像拉取完成: ${image}\n${result.stdout.slice(-500)}` };
      }

      if (action === "rmi") {
        const image = p.image as string;
        if (!image) return { success: false, message: "❌ rmi 需要 image 参数" };
        const force = p.force ? "-f" : "";
        const result = await docker(`rmi ${force} ${image}`);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🗑️ 镜像 ${image} 已删除` };
      }

      if (action === "build") {
        const image = p.image as string;
        const context = (p.buildContext as string) || ".";
        const dockerfile = (p.dockerfile as string) || "Dockerfile";
        if (!image) return { success: false, message: "❌ build 需要 image 参数（镜像名:标签）" };

        const result = await docker(`build -t ${image} -f ${dockerfile} ${context}`, 300000);
        if (!result.ok) return { success: false, message: `❌ 构建失败:\n${result.stderr.slice(0, 1000)}` };
        return { success: true, message: `🏗️ 镜像构建完成: ${image}\n${result.stdout.slice(-500)}` };
      }

      if (action === "prune") {
        const force = p.force ? "-f" : "";
        const result = await docker(`system prune ${force} --volumes`, 60000);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🧹 清理完成\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout}` };
      }

      if (action === "inspect") {
        const container = p.container as string;
        if (!container) return { success: false, message: "❌ inspect 需要 container 参数" };
        const result = await docker(`inspect ${container}`);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        try {
          const data = JSON.parse(result.stdout);
          const info = Array.isArray(data) ? data[0] : data;
          const lines = [
            `🔍 容器详情: ${container}`,
            `━━━━━━━━━━━━━━━━━━━━`,
            `📛 名称: ${info.Name}`,
            `🔑 ID: ${info.Id?.slice(0, 12)}`,
            `📀 镜像: ${info.Config?.Image}`,
            `📊 状态: ${info.State?.Status}`,
            `📅 创建: ${info.Created}`,
            `🌐 IP: ${info.NetworkSettings?.IPAddress || "无"}`,
          ];
          const ports = info.NetworkSettings?.Ports;
          if (ports) {
            lines.push(`🔌 端口映射:`);
            for (const [k, v] of Object.entries(ports)) {
              const bindings = v as Array<{ HostPort: string }> | null;
              lines.push(`  ${k} → ${bindings ? bindings.map(b => b.HostPort).join(", ") : "未映射"}`);
            }
          }
          const mounts = info.Mounts as Array<{ Source: string; Destination: string }> | undefined;
          if (mounts && mounts.length > 0) {
            lines.push(`📂 挂载:`);
            for (const m of mounts) lines.push(`  ${m.Source} → ${m.Destination}`);
          }
          return { success: true, message: lines.join("\n") };
        } catch {
          return { success: true, message: `🔍 容器详情:\n${result.stdout.slice(0, 3000)}` };
        }
      }

      if (action === "stats") {
        const container = p.container as string;
        const target = container || "";
        const result = await docker(`stats --no-stream ${target} --format "{{json .}}"`, 15000);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        const stats = parseContainerList(result.stdout);
        if (stats.length === 0) return { success: true, message: "📊 没有运行中的容器" };

        const lines = [`📊 容器资源使用`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const s of stats) {
          lines.push(`🐳 ${s.Name || s.Container}`);
          lines.push(`  💻 CPU: ${s.CPUPerc}`);
          lines.push(`  🧠 内存: ${s.MemUsage} (${s.MemPerc})`);
          lines.push(`  🌐 网络: ↑${s.NetIO}`);
          lines.push(`  💽 磁盘: ${s.BlockIO}`);
        }
        return { success: true, message: lines.join("\n") };
      }

      if (action === "export") {
        const container = p.container as string;
        if (!container) return { success: false, message: "❌ export 需要 container 参数" };
        const outDir = path.join(DESKTOP, "output-docker");
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${container}-export.tar`);
        const result = await docker(`export ${container} -o "${outFile}"`, 120000);
        if (!result.ok) return { success: false, message: `❌ 导出失败: ${result.stderr}` };
        return { success: true, message: `📤 容器导出完成\n📁 文件: ${outFile}` };
      }

      if (action === "compose_up") {
        const composePath = p.composePath as string;
        const cwd = composePath ? path.dirname(composePath) : undefined;
        const file = composePath ? `-f "${path.basename(composePath)}"` : "";
        const detach = p.detach !== false ? "-d" : "";
        const result = await dockerCompose(`${file} up ${detach}`, cwd, 120000);
        if (!result.ok) return { success: false, message: `❌ compose up 失败:\n${result.stderr}` };
        return { success: true, message: `🚀 Compose 启动完成\n${result.stdout || result.stderr}` };
      }

      if (action === "compose_down") {
        const composePath = p.composePath as string;
        const cwd = composePath ? path.dirname(composePath) : undefined;
        const file = composePath ? `-f "${path.basename(composePath)}"` : "";
        const result = await dockerCompose(`${file} down`, cwd);
        if (!result.ok) return { success: false, message: `❌ compose down 失败:\n${result.stderr}` };
        return { success: true, message: `⏹️ Compose 已停止\n${result.stdout || result.stderr}` };
      }

      if (action === "compose_ps") {
        const composePath = p.composePath as string;
        const cwd = composePath ? path.dirname(composePath) : undefined;
        const file = composePath ? `-f "${path.basename(composePath)}"` : "";
        const result = await dockerCompose(`${file} ps`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🐳 Compose 服务状态\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout || "(无服务)"}` };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ Docker 操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
