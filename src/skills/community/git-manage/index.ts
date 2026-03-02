import { z } from "zod";
import type { SkillDefinition } from "../types";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);

async function git(cmd: string, cwd?: string, timeout = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`git ${cmd}`, { cwd, timeout });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not recognized") || msg.includes("not found")) {
      return { ok: false, stdout: "", stderr: "Git 未安装，请安装: https://git-scm.com/download" };
    }
    return { ok: false, stdout: "", stderr: msg.slice(0, 1500) };
  }
}

function resolveRepo(repoPath?: string): string {
  return repoPath || process.cwd();
}

export const gitManageSkill: SkillDefinition = {
  name: "git_manage",
  displayName: "代码仓库管理",
  description: `Git 版本控制管理工具。支持：克隆(clone)、状态(status)、提交(commit)、推送(push)、拉取(pull)、分支管理(branch)、日志(log)、差异(diff)、暂存(stash)、标签(tag)、远程(remote)、初始化(init)、重置(reset)、合并(merge)、变基(rebase)、cherry-pick。用户说'git'、'仓库'、'提交代码'、'推送'、'拉取'、'分支'、'合并'、'克隆'、'版本控制'时使用。`,
  icon: "GitBranch",
  category: "dev",
  parameters: z.object({
    action: z.enum([
      "clone", "init", "status", "add", "commit", "push", "pull",
      "branch", "checkout", "log", "diff", "stash", "tag",
      "remote", "reset", "merge", "rebase", "cherry_pick",
      "blame", "show",
    ]).describe("Git 操作"),
    repoPath: z.string().optional().describe("仓库本地路径（默认当前目录）"),
    url: z.string().optional().describe("远程仓库 URL（clone 使用）"),
    message: z.string().optional().describe("提交信息（commit 使用）"),
    branch: z.string().optional().describe("分支名称"),
    files: z.array(z.string()).optional().describe("文件列表（add 使用），空数组=全部 add"),
    remote: z.string().optional().describe("远程名称，默认 origin"),
    tag: z.string().optional().describe("标签名称"),
    count: z.number().optional().describe("日志条数（log），默认20"),
    file: z.string().optional().describe("文件路径（diff/blame/show 使用）"),
    commitHash: z.string().optional().describe("提交哈希（reset/cherry_pick/show）"),
    force: z.boolean().optional().describe("强制操作"),
    createBranch: z.boolean().optional().describe("checkout 时创建新分支"),
    stashAction: z.string().optional().describe("stash 子操作：save/pop/list/drop/apply"),
    stashMessage: z.string().optional().describe("stash 保存消息"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;
    const cwd = resolveRepo(p.repoPath as string | undefined);

    try {
      if (action === "clone") {
        const url = p.url as string;
        if (!url) return { success: false, message: "❌ clone 需要 url 参数" };
        const targetDir = p.repoPath || path.join("C:\\Users\\Administrator\\Desktop", path.basename(url, ".git"));
        const result = await git(`clone "${url}" "${targetDir}"`, undefined, 120000);
        if (!result.ok) return { success: false, message: `❌ 克隆失败:\n${result.stderr}` };
        return { success: true, message: `📥 仓库克隆完成\n━━━━━━━━━━━━━━━━━━━━\n🔗 URL: ${url}\n📁 路径: ${targetDir}` };
      }

      if (action === "init") {
        if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });
        const result = await git("init", cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🎉 Git 仓库初始化完成\n📁 路径: ${cwd}` };
      }

      if (action === "status") {
        const result = await git("status --short --branch", cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        const statusResult = await git("status", cwd);

        const lines = [`📋 Git 状态`, `━━━━━━━━━━━━━━━━━━━━`, `📁 仓库: ${cwd}`];
        if (result.stdout) {
          const statusLines = result.stdout.split("\n");
          const branchLine = statusLines[0];
          lines.push(`🔀 ${branchLine}`);
          const fileLines = statusLines.slice(1).filter(l => l.trim());
          if (fileLines.length > 0) {
            lines.push(`\n📝 变更文件 (${fileLines.length}):`);
            const statusEmoji: Record<string, string> = { M: "✏️", A: "➕", D: "🗑️", R: "📛", C: "📋", U: "⚠️", "?": "❓" };
            for (const f of fileLines.slice(0, 50)) {
              const code = f.trim().charAt(0);
              lines.push(`  ${statusEmoji[code] || "📎"} ${f.trim()}`);
            }
          } else {
            lines.push(`\n✅ 工作区干净`);
          }
        }
        return { success: true, message: lines.join("\n") };
      }

      if (action === "add") {
        const files = p.files as string[] | undefined;
        const target = files && files.length > 0 ? files.join(" ") : ".";
        const result = await git(`add ${target}`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `➕ 已暂存: ${target === "." ? "所有变更" : files!.join(", ")}` };
      }

      if (action === "commit") {
        const message = p.message as string;
        if (!message) return { success: false, message: "❌ commit 需要 message 参数" };
        const result = await git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
        if (!result.ok) return { success: false, message: `❌ 提交失败:\n${result.stderr}` };
        return { success: true, message: `✅ 提交成功\n━━━━━━━━━━━━━━━━━━━━\n💬 ${message}\n${result.stdout}` };
      }

      if (action === "push") {
        const remote = (p.remote as string) || "origin";
        const branch = p.branch || "";
        const force = p.force ? "--force" : "";
        const result = await git(`push ${force} ${remote} ${branch}`.trim(), cwd, 60000);
        if (!result.ok) return { success: false, message: `❌ 推送失败:\n${result.stderr}` };
        return { success: true, message: `📤 推送成功\n${result.stdout || result.stderr}` };
      }

      if (action === "pull") {
        const remote = (p.remote as string) || "origin";
        const branch = p.branch || "";
        const result = await git(`pull ${remote} ${branch}`.trim(), cwd, 60000);
        if (!result.ok) return { success: false, message: `❌ 拉取失败:\n${result.stderr}` };
        return { success: true, message: `📥 拉取成功\n${result.stdout || result.stderr}` };
      }

      if (action === "branch") {
        const branch = p.branch as string | undefined;
        if (branch) {
          const result = await git(`branch ${branch}`, cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `🔀 分支 ${branch} 已创建` };
        }
        const result = await git("branch -a --format='%(HEAD) %(refname:short) %(upstream:short) %(objectname:short)'", cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        const lines = [`🔀 分支列表`, `━━━━━━━━━━━━━━━━━━━━`];
        for (const line of result.stdout.split("\n").filter(l => l.trim())) {
          const isCurrent = line.startsWith("*");
          lines.push(`  ${isCurrent ? "👉" : "  "} ${line.replace(/^[*\s]+/, "").replace(/'/g, "")}`);
        }
        return { success: true, message: lines.join("\n") };
      }

      if (action === "checkout") {
        const branch = p.branch as string;
        if (!branch) return { success: false, message: "❌ checkout 需要 branch 参数" };
        const flag = p.createBranch ? "-b" : "";
        const result = await git(`checkout ${flag} ${branch}`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🔀 已切换到 ${p.createBranch ? "新" : ""}分支: ${branch}` };
      }

      if (action === "log") {
        const count = (p.count as number) || 20;
        const fileFilter = p.file ? ` -- "${p.file}"` : "";
        const result = await git(`log --oneline --graph --decorate -n ${count}${fileFilter}`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `📜 提交历史 (最近${count}条)\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout}` };
      }

      if (action === "diff") {
        const file = p.file as string | undefined;
        const target = file ? `-- "${file}"` : "";
        const result = await git(`diff ${target}`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        if (!result.stdout) return { success: true, message: "✅ 没有未暂存的变更" };
        return { success: true, message: `📝 差异\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout.slice(0, 5000)}` };
      }

      if (action === "stash") {
        const sub = (p.stashAction as string) || "save";
        if (sub === "save") {
          const msg = p.stashMessage ? `-m "${(p.stashMessage as string).replace(/"/g, '\\"')}"` : "";
          const result = await git(`stash push ${msg}`, cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `📦 已暂存工作区\n${result.stdout}` };
        }
        if (sub === "pop") {
          const result = await git("stash pop", cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `📤 已恢复暂存\n${result.stdout}` };
        }
        if (sub === "list") {
          const result = await git("stash list", cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `📦 Stash 列表\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout || "(空)"}` };
        }
        if (sub === "drop") {
          const result = await git("stash drop", cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `🗑️ 已丢弃最近的 stash` };
        }
        if (sub === "apply") {
          const result = await git("stash apply", cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `📤 已应用暂存（保留 stash）\n${result.stdout}` };
        }
        return { success: false, message: `❌ 未知 stash 操作: ${sub}` };
      }

      if (action === "tag") {
        const tagName = p.tag as string | undefined;
        if (tagName) {
          const msg = p.message ? `-a -m "${(p.message as string).replace(/"/g, '\\"')}"` : "";
          const result = await git(`tag ${msg} ${tagName}`, cwd);
          if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
          return { success: true, message: `🏷️ 标签 ${tagName} 已创建` };
        }
        const result = await git("tag -l --sort=-creatordate", cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🏷️ 标签列表\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout || "(无标签)"}` };
      }

      if (action === "remote") {
        const result = await git("remote -v", cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🌐 远程仓库\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout || "(无远程)"}` };
      }

      if (action === "reset") {
        const hash = p.commitHash as string;
        if (!hash) return { success: false, message: "❌ reset 需要 commitHash 参数" };
        const mode = p.force ? "--hard" : "--mixed";
        const result = await git(`reset ${mode} ${hash}`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `⏪ 重置完成 (${mode})\n${result.stdout}` };
      }

      if (action === "merge") {
        const branch = p.branch as string;
        if (!branch) return { success: false, message: "❌ merge 需要 branch 参数" };
        const result = await git(`merge ${branch}`, cwd);
        if (!result.ok) return { success: false, message: `❌ 合并冲突或失败:\n${result.stderr}` };
        return { success: true, message: `🔀 合并完成: ${branch}\n${result.stdout}` };
      }

      if (action === "rebase") {
        const branch = p.branch as string;
        if (!branch) return { success: false, message: "❌ rebase 需要 branch 参数" };
        const result = await git(`rebase ${branch}`, cwd);
        if (!result.ok) return { success: false, message: `❌ 变基失败:\n${result.stderr}\n\n使用 git rebase --abort 取消` };
        return { success: true, message: `🔄 变基完成: ${branch}\n${result.stdout}` };
      }

      if (action === "cherry_pick") {
        const hash = p.commitHash as string;
        if (!hash) return { success: false, message: "❌ cherry_pick 需要 commitHash 参数" };
        const result = await git(`cherry-pick ${hash}`, cwd);
        if (!result.ok) return { success: false, message: `❌ Cherry-pick 失败:\n${result.stderr}` };
        return { success: true, message: `🍒 Cherry-pick 完成: ${hash}\n${result.stdout}` };
      }

      if (action === "blame") {
        const file = p.file as string;
        if (!file) return { success: false, message: "❌ blame 需要 file 参数" };
        const result = await git(`blame --line-porcelain "${file}"`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `🔍 Blame: ${file}\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout.slice(0, 5000)}` };
      }

      if (action === "show") {
        const hash = (p.commitHash as string) || "HEAD";
        const result = await git(`show --stat ${hash}`, cwd);
        if (!result.ok) return { success: false, message: `❌ ${result.stderr}` };
        return { success: true, message: `📝 提交详情: ${hash}\n━━━━━━━━━━━━━━━━━━━━\n${result.stdout.slice(0, 5000)}` };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ Git 操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
