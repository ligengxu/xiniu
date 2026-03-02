import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { SkillDefinition } from "../types";
import {
  saveCredential,
  getCredential,
  listCredentials,
  deleteCredential,
  touchCredential,
} from "@/lib/credential-store";

function runCmd(cmd: string, args: string[], timeoutMs = 30000, stdinData?: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs, shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    if (stdinData) {
      proc.stdin?.write(stdinData);
      proc.stdin?.end();
    }

    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message }));
  });
}

async function ensureSshpass(): Promise<boolean> {
  const r = await runCmd("where", ["sshpass"], 5000);
  if (r.ok) return true;

  const r2 = await runCmd("where", ["plink"], 5000);
  return r2.ok;
}

async function hasPlink(): Promise<boolean> {
  const r = await runCmd("where", ["plink"], 5000);
  return r.ok;
}

async function sshExec(host: string, port: number, username: string, password: string, command: string, timeoutMs = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const usePlink = await hasPlink();

  if (usePlink) {
    const args = ["-ssh", "-P", String(port), "-l", username, "-pw", password, "-batch", host, command];
    return runCmd("plink", args, timeoutMs);
  }

  const tmpScript = path.join(os.tmpdir(), `xiniu_ssh_${Date.now()}.ps1`);
  const psScript = `
$ErrorActionPreference = 'Stop'
$pass = ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${username}', $pass)
try {
  $session = New-PSSession -HostName '${host}' -Port ${port} -UserName '${username}' -SSHTransport -ErrorAction Stop
  $result = Invoke-Command -Session $session -ScriptBlock { ${command} }
  Remove-PSSession $session
  Write-Output $result
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;
  await fs.writeFile(tmpScript, psScript, "utf-8");
  const r = await runCmd("powershell", ["-ExecutionPolicy", "Bypass", "-File", tmpScript], timeoutMs);
  await fs.unlink(tmpScript).catch(() => {});
  return r;
}

async function sshUpload(host: string, port: number, username: string, password: string, localPath: string, remotePath: string): Promise<{ ok: boolean; message: string }> {
  const resolved = path.resolve(localPath);
  try { await fs.access(resolved); } catch { return { ok: false, message: `本地文件不存在: ${resolved}` }; }
  const stats = await fs.stat(resolved);

  const usePlink = await hasPlink();

  if (usePlink) {
    const args = ["-P", String(port), "-l", username, "-pw", password, "-batch", resolved, `${username}@${host}:${remotePath}`];
    const r = await runCmd("pscp", args, 120000);
    if (r.ok) return { ok: true, message: `已上传 ${path.basename(resolved)} → ${remotePath} (${(stats.size / 1024).toFixed(1)}KB)` };
    return { ok: false, message: `上传失败: ${r.stderr}` };
  }

  const args = ["-P", String(port), resolved, `${username}@${host}:${remotePath}`];
  const r = await runCmd("scp", args, 120000, password + "\n");
  if (r.ok) return { ok: true, message: `已上传 ${path.basename(resolved)} → ${remotePath} (${(stats.size / 1024).toFixed(1)}KB)` };
  return { ok: false, message: `上传失败: ${r.stderr || "SCP超时或需要交互确认"}` };
}

async function sshDownload(host: string, port: number, username: string, password: string, remotePath: string, localPath: string): Promise<{ ok: boolean; message: string }> {
  const resolved = path.resolve(localPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  const usePlink = await hasPlink();

  if (usePlink) {
    const args = ["-P", String(port), "-l", username, "-pw", password, "-batch", `${username}@${host}:${remotePath}`, resolved];
    const r = await runCmd("pscp", args, 120000);
    if (r.ok) {
      const st = await fs.stat(resolved).catch(() => null);
      return { ok: true, message: `已下载 ${remotePath} → ${resolved} (${st ? (st.size / 1024).toFixed(1) + "KB" : "?"})` };
    }
    return { ok: false, message: `下载失败: ${r.stderr}` };
  }

  const args = ["-P", String(port), `${username}@${host}:${remotePath}`, resolved];
  const r = await runCmd("scp", args, 120000, password + "\n");
  if (r.ok) {
    const st = await fs.stat(resolved).catch(() => null);
    return { ok: true, message: `已下载 ${remotePath} → ${resolved} (${st ? (st.size / 1024).toFixed(1) + "KB" : "?"})` };
  }
  return { ok: false, message: `下载失败: ${r.stderr || "SCP超时"}` };
}

export const sshManageSkill: SkillDefinition = {
  name: "ssh_manage",
  displayName: "远程服务器管理",
  description:
    "SSH远程服务器管理：连接测试、执行命令、上传/下载文件、查看文件列表。首次使用会保存凭证到加密记忆，后续自动复用（会确认是否使用已保存的账号）。用户说'SSH'、'远程服务器'、'上传到服务器'、'服务器执行命令'时使用。",
  icon: "Terminal",
  category: "dev",
  parameters: z.object({
    action: z.enum(["connect_test", "exec", "upload", "download", "list_files", "list_saved", "delete_saved"])
      .describe("操作: connect_test=测试连接, exec=执行命令, upload=上传文件, download=下载文件, list_files=列出远程目录, list_saved=列出已保存的SSH凭证, delete_saved=删除已保存的凭证"),
    host: z.string().optional().describe("服务器地址(如果已保存过可不填，会自动使用最近的)"),
    port: z.number().optional().describe("SSH端口，默认22"),
    username: z.string().optional().describe("用户名"),
    password: z.string().optional().describe("密码(首次连接需要，之后自动从记忆中读取)"),
    command: z.string().optional().describe("exec操作的Shell命令"),
    localPath: z.string().optional().describe("upload/download的本地文件路径"),
    remotePath: z.string().optional().describe("upload/download的远程文件路径，或list_files的远程目录"),
    saveCredential: z.boolean().optional().describe("是否保存凭证到长期记忆，默认true"),
    credentialId: z.string().optional().describe("delete_saved时指定凭证ID"),
    timeout: z.number().optional().describe("命令超时毫秒数，默认30000"),
  }),
  execute: async (params) => {
    const {
      action,
      host: inputHost,
      port: inputPort = 22,
      username: inputUser,
      password: inputPwd,
      command,
      localPath,
      remotePath,
      saveCredential: shouldSave = true,
      credentialId,
      timeout = 30000,
    } = params as {
      action: string; host?: string; port?: number; username?: string; password?: string;
      command?: string; localPath?: string; remotePath?: string;
      saveCredential?: boolean; credentialId?: string; timeout?: number;
    };

    try {
      if (action === "list_saved") {
        const saved = await listCredentials("ssh");
        if (saved.length === 0) {
          return { success: true, message: "暂无保存的SSH凭证。首次连接服务器时会自动保存。" };
        }
        let msg = `已保存的SSH凭证 (${saved.length}个):\n`;
        for (const c of saved) {
          msg += `[${c.id}] ${c.username}@${c.host}:${c.port || 22} | 最后使用: ${c.lastUsedAt}\n`;
        }
        return { success: true, message: msg, data: { credentials: saved } };
      }

      if (action === "delete_saved") {
        if (!credentialId) return { success: false, message: "需要提供 credentialId" };
        const ok = await deleteCredential(credentialId);
        return { success: ok, message: ok ? `凭证已删除: ${credentialId}` : `未找到凭证: ${credentialId}` };
      }

      let host = inputHost || "";
      let port = inputPort;
      let username = inputUser || "";
      let password = inputPwd || "";

      if (!host || !username || !password) {
        const saved = await getCredential("ssh", host || undefined, username || undefined);
        if (saved) {
          host = host || saved.host;
          port = inputPort || saved.port || 22;
          username = username || saved.username;
          password = password || saved.password;
          await touchCredential(saved.id);

          if (!inputHost && !inputUser) {
            return {
              success: true,
              message: `找到已保存的SSH凭证:\n  标签: ${saved.label}\n  地址: ${saved.username}@${saved.host}:${port}\n\n请确认是否使用此凭证。如需使用其他服务器，请提供 host 和 username 参数。`,
              data: { savedCredential: { id: saved.id, label: saved.label, host: saved.host, username: saved.username, port } },
            };
          }
        } else if (!host || !username || !password) {
          return {
            success: false,
            message: `首次连接需要完整的 host、username、password 参数。\n示例: host="192.168.1.100" username="root" password="xxx"`,
          };
        }
      }

      const hasTool = await hasPlink();
      if (!hasTool) {
        const sshCheck = await runCmd("where", ["ssh"], 5000);
        if (!sshCheck.ok) {
          return {
            success: false,
            message: `未检测到SSH工具。请安装以下任一工具:\n1. PuTTY (推荐，含plink+pscp): https://www.chiark.greenend.org.uk/~sgtatham/putty/\n2. OpenSSH (Windows可选功能): 设置→应用→可选功能→添加OpenSSH客户端\n\n安装后重试即可。`,
          };
        }
      }

      if (shouldSave && password) {
        await saveCredential({
          type: "ssh",
          label: `${username}@${host}`,
          host,
          port,
          username,
          password,
        });
      }

      switch (action) {
        case "connect_test": {
          const r = await sshExec(host, port, username, password, "echo SSH_OK && hostname && whoami && uptime 2>nul || echo SSH_OK && hostname && whoami", timeout);
          if (r.ok || r.stdout.includes("SSH_OK")) {
            return {
              success: true,
              message: `SSH连接成功!\n${username}@${host}:${port}\n\n${r.stdout.trim()}\n\n凭证已保存到长期记忆，下次可直接使用。`,
              data: { host, port, username, systemInfo: r.stdout.trim() },
            };
          }
          return { success: false, message: `SSH连接失败: ${r.stderr || r.stdout}` };
        }

        case "exec": {
          if (!command) return { success: false, message: "exec操作需要 command 参数" };
          const r = await sshExec(host, port, username, password, command, timeout);
          const output = r.stdout + (r.stderr ? `\n[stderr] ${r.stderr}` : "");
          return {
            success: r.ok,
            message: r.ok
              ? `命令执行成功 (${username}@${host})\n$ ${command}\n\n${output.trim() || "(无输出)"}`
              : `命令执行失败\n$ ${command}\n\n${output.trim()}`,
            data: { host, command, output: output.trim(), exitOk: r.ok },
          };
        }

        case "upload": {
          if (!localPath || !remotePath) return { success: false, message: "upload需要 localPath 和 remotePath 参数" };
          const r = await sshUpload(host, port, username, password, localPath, remotePath);
          return {
            success: r.ok,
            message: r.ok ? `${r.message}\n${username}@${host}` : r.message,
            data: { host, localPath, remotePath },
          };
        }

        case "download": {
          if (!remotePath || !localPath) return { success: false, message: "download需要 remotePath 和 localPath 参数" };
          const r = await sshDownload(host, port, username, password, remotePath, localPath);
          return {
            success: r.ok,
            message: r.ok ? `${r.message}\n${username}@${host}` : r.message,
            data: { host, remotePath, localPath },
          };
        }

        case "list_files": {
          const dir = remotePath || "/";
          const r = await sshExec(host, port, username, password, `ls -la ${dir}`, timeout);
          return {
            success: r.ok,
            message: r.ok
              ? `远程目录 ${dir} (${username}@${host}):\n\n${r.stdout.trim()}`
              : `列出目录失败: ${r.stderr || r.stdout}`,
            data: { host, directory: dir, listing: r.stdout.trim() },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `SSH操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
