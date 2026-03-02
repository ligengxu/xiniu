import { z } from "zod";
import type { SkillDefinition } from "../types";

export const changelogGenSkill: SkillDefinition = {
  name: "changelog_gen",
  displayName: "更新日志生成",
  description:
    "从Git提交历史自动生成CHANGELOG.md更新日志，按版本/日期分组，自动分类提交类型。" +
    "用户说'CHANGELOG'、'更新日志'、'发布说明'、'release notes'时使用。",
  icon: "ClipboardList",
  category: "dev",
  parameters: z.object({
    projectPath: z.string().describe("项目根目录(需是Git仓库)"),
    version: z.string().optional().describe("当前版本号(如1.2.0)，不填则从package.json读取"),
    since: z.string().optional().describe("起始日期或标签(如2025-01-01或v1.0.0)"),
    savePath: z.string().optional().describe("保存路径，默认项目根目录"),
  }),
  execute: async (params) => {
    const { projectPath, version, since, savePath } = params as {
      projectPath: string; version?: string; since?: string; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(execFile);

      if (!fs.existsSync(path.join(projectPath, ".git"))) {
        return { success: false, message: "❌ 目录不是Git仓库" };
      }

      let ver = version || "";
      if (!ver) {
        const pkgPath = path.join(projectPath, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            ver = pkg.version || "Unreleased";
          } catch { ver = "Unreleased"; }
        } else {
          ver = "Unreleased";
        }
      }

      const logArgs = ["log", "--pretty=format:%H|%s|%an|%ai", "--no-merges"];
      if (since) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(since)) {
          logArgs.push(`--since=${since}`);
        } else {
          logArgs.push(`${since}..HEAD`);
        }
      } else {
        logArgs.push("-100");
      }

      const { stdout } = await execAsync("git", logArgs, { cwd: projectPath, timeout: 15000 });

      if (!stdout.trim()) return { success: true, message: "📋 无提交记录" };

      const typeMap: Record<string, { label: string; emoji: string }> = {
        feat: { label: "新功能", emoji: "✨" },
        fix: { label: "修复", emoji: "🐛" },
        docs: { label: "文档", emoji: "📝" },
        style: { label: "样式", emoji: "💄" },
        refactor: { label: "重构", emoji: "♻️" },
        perf: { label: "性能", emoji: "⚡" },
        test: { label: "测试", emoji: "✅" },
        build: { label: "构建", emoji: "📦" },
        ci: { label: "CI", emoji: "🔧" },
        chore: { label: "杂项", emoji: "🔨" },
        revert: { label: "回退", emoji: "⏪" },
      };

      const grouped: Record<string, string[]> = {};
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const [, subject] = line.split("|");
        if (!subject) continue;

        const typeMatch = subject.match(/^(\w+)(?:\(.*?\))?:\s*(.+)/);
        let type = "other";
        let msg = subject;
        if (typeMatch) {
          type = typeMatch[1].toLowerCase();
          msg = typeMatch[2];
        }

        const category = typeMap[type]?.label || "其他";
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(msg);
      }

      const today = new Date().toISOString().slice(0, 10);
      const sections: string[] = [];
      sections.push(`# 更新日志\n`);
      sections.push(`## [${ver}] - ${today}\n`);

      for (const [category, items] of Object.entries(grouped)) {
        const typeEntry = Object.values(typeMap).find((t) => t.label === category);
        const emoji = typeEntry?.emoji || "📌";
        sections.push(`### ${emoji} ${category}\n`);
        for (const item of items) sections.push(`- ${item}`);
        sections.push("");
      }

      const changelog = sections.join("\n");
      const outputPath = savePath || path.join(projectPath, "CHANGELOG.md");
      fs.writeFileSync(outputPath, changelog, "utf-8");

      const totalCommits = stdout.split("\n").filter(Boolean).length;
      let msg = `✅ CHANGELOG.md 已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📋 版本: ${ver}\n📊 提交数: ${totalCommits}\n`;
      msg += `📂 分类: ${Object.keys(grouped).join(", ")}\n`;
      msg += `📁 保存: ${outputPath}`;

      return { success: true, message: msg, data: { path: outputPath, version: ver, commits: totalCommits } };
    } catch (err) {
      return { success: false, message: `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
