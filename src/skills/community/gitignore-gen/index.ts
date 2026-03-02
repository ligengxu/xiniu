import { z } from "zod";
import type { SkillDefinition } from "../types";

const TEMPLATES: Record<string, string[]> = {
  node: [
    "node_modules/", "dist/", "build/", ".next/", ".nuxt/", ".output/",
    "npm-debug.log*", "yarn-debug.log*", "yarn-error.log*", "pnpm-debug.log*",
    ".env", ".env.local", ".env.*.local", "*.tsbuildinfo", ".turbo/",
    "coverage/", ".nyc_output/", "*.tgz",
  ],
  python: [
    "__pycache__/", "*.py[cod]", "*$py.class", "*.so",
    "venv/", ".venv/", "env/", ".env/", "ENV/",
    "dist/", "build/", "*.egg-info/", "*.egg",
    ".pytest_cache/", ".mypy_cache/", ".ruff_cache/",
    "*.whl", ".ipynb_checkpoints/", "htmlcov/",
  ],
  java: [
    "target/", "*.class", "*.jar", "*.war", "*.ear",
    ".idea/", "*.iml", "*.iws", "*.ipr",
    ".gradle/", "build/", "out/",
    "hs_err_pid*", ".settings/", ".project", ".classpath",
  ],
  go: [
    "bin/", "vendor/", "*.exe", "*.exe~", "*.dll", "*.so", "*.dylib",
    "*.test", "*.out", "go.work", "coverage.txt", "coverage.html",
  ],
  rust: [
    "target/", "Cargo.lock", "**/*.rs.bk",
  ],
  dotnet: [
    "bin/", "obj/", "*.suo", "*.user", "*.userosscache", "*.sln.docstates",
    ".vs/", "*.nupkg", "packages/", "project.lock.json",
    "*.dll", "*.exe", "*.pdb",
  ],
  unity: [
    "[Ll]ibrary/", "[Tt]emp/", "[Oo]bj/", "[Bb]uild/", "[Bb]uilds/",
    "[Ll]ogs/", "[Uu]ser[Ss]ettings/",
    "*.csproj", "*.unityproj", "*.sln", "*.suo", "*.tmp", "*.user",
    "*.pidb", "*.booproj", "*.svd", "*.pdb", "*.mdb",
    "sysinfo.txt", "crashlytics-build.properties",
  ],
  common: [
    ".DS_Store", "Thumbs.db", "ehthumbs.db", "Desktop.ini",
    "*.swp", "*.swo", "*~", "*.bak", "*.tmp", "*.log",
    ".idea/", ".vscode/", "*.sublime-*",
  ],
};

export const gitignoreGenSkill: SkillDefinition = {
  name: "gitignore_gen",
  displayName: "忽略规则生成",
  description:
    "生成.gitignore文件，支持Node/Python/Java/Go/Rust/.NET/Unity等项目模板，可组合多个模板。" +
    "用户说'gitignore'、'.gitignore'、'忽略规则'、'git忽略'时使用。",
  icon: "EyeOff",
  category: "dev",
  parameters: z.object({
    templates: z.array(z.string()).describe("模板列表: node/python/java/go/rust/dotnet/unity/common，可多选组合"),
    extra: z.array(z.string()).optional().describe("额外自定义忽略规则"),
    savePath: z.string().optional().describe("保存路径，默认桌面/.gitignore"),
  }),
  execute: async (params) => {
    const { templates, extra, savePath } = params as {
      templates: string[]; extra?: string[]; savePath?: string;
    };

    if (!templates || templates.length === 0) {
      let msg = `📋 可用模板\n━━━━━━━━━━━━━━━━━━━━\n`;
      for (const [name, rules] of Object.entries(TEMPLATES)) {
        msg += `  • ${name} (${rules.length}条规则)\n`;
      }
      msg += `\n💡 示例: templates: ["node", "common"]`;
      return { success: true, message: msg };
    }

    try {
      const fs = await import("fs");
      const path = await import("path");

      const sections: string[] = [];
      const usedTemplates: string[] = [];

      for (const tmpl of templates) {
        const rules = TEMPLATES[tmpl.toLowerCase()];
        if (!rules) continue;
        usedTemplates.push(tmpl);
        sections.push(`# === ${tmpl.toUpperCase()} ===`);
        sections.push(...rules);
        sections.push("");
      }

      if (extra && extra.length > 0) {
        sections.push("# === CUSTOM ===");
        sections.push(...extra);
        sections.push("");
      }

      if (sections.length === 0) {
        return { success: false, message: `❌ 未匹配到有效模板\n可用: ${Object.keys(TEMPLATES).join(", ")}` };
      }

      const content = sections.join("\n");
      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", ".gitignore");
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, content, "utf-8");

      const totalRules = content.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;

      let msg = `✅ .gitignore 已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📋 模板: ${usedTemplates.join(" + ")}\n`;
      msg += `📊 规则数: ${totalRules}条\n`;
      msg += `📁 保存: ${outputPath}`;

      return { success: true, message: msg, data: { path: outputPath, rules: totalRules, templates: usedTemplates } };
    } catch (err) {
      return { success: false, message: `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
