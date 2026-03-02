import { z } from "zod";
import type { SkillDefinition } from "../types";

export const readmeGenSkill: SkillDefinition = {
  name: "readme_gen",
  displayName: "项目说明生成",
  description:
    "扫描项目目录自动生成README.md文件，包含项目名称、描述、目录结构、安装步骤、使用方法等。" +
    "用户说'README'、'项目说明'、'生成文档'时使用。",
  icon: "FileText",
  category: "dev",
  parameters: z.object({
    projectPath: z.string().describe("项目根目录路径"),
    name: z.string().optional().describe("项目名称(不填则从package.json/目录名推断)"),
    description: z.string().optional().describe("项目描述"),
    features: z.array(z.string()).optional().describe("功能特性列表"),
    savePath: z.string().optional().describe("README保存路径，默认项目根目录"),
  }),
  execute: async (params) => {
    const { projectPath, name, description, features, savePath } = params as {
      projectPath: string; name?: string; description?: string;
      features?: string[]; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");

      if (!fs.existsSync(projectPath)) return { success: false, message: `❌ 目录不存在: ${projectPath}` };

      let projName = name || path.basename(projectPath);
      let projDesc = description || "";
      let projVersion = "";
      let projLicense = "";
      let scripts: Record<string, string> = {};
      let deps: string[] = [];
      let devDeps: string[] = [];

      const pkgPath = path.join(projectPath, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          projName = name || pkg.name || projName;
          projDesc = description || pkg.description || "";
          projVersion = pkg.version || "";
          projLicense = pkg.license || "";
          scripts = pkg.scripts || {};
          deps = Object.keys(pkg.dependencies || {});
          devDeps = Object.keys(pkg.devDependencies || {});
        } catch {}
      }

      const pyPath = path.join(projectPath, "requirements.txt");
      const goPath = path.join(projectPath, "go.mod");
      const cargoPath = path.join(projectPath, "Cargo.toml");

      let techStack = "Unknown";
      if (fs.existsSync(pkgPath)) techStack = "Node.js / JavaScript";
      else if (fs.existsSync(pyPath)) techStack = "Python";
      else if (fs.existsSync(goPath)) techStack = "Go";
      else if (fs.existsSync(cargoPath)) techStack = "Rust";

      const topLevel: string[] = [];
      try {
        const entries = fs.readdirSync(projectPath, { withFileTypes: true });
        for (const e of entries.slice(0, 30)) {
          if (e.name.startsWith(".") && e.name !== ".env.example") continue;
          if (e.name === "node_modules" || e.name === "__pycache__") continue;
          topLevel.push(e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`);
        }
      } catch {}

      const sections: string[] = [];
      sections.push(`# ${projName}\n`);
      if (projDesc) sections.push(`${projDesc}\n`);
      if (projVersion) sections.push(`![Version](https://img.shields.io/badge/version-${projVersion}-blue) `);
      if (projLicense) sections.push(`![License](https://img.shields.io/badge/license-${projLicense}-green)\n`);

      if (features && features.length > 0) {
        sections.push(`\n## ✨ 功能特性\n`);
        for (const f of features) sections.push(`- ${f}`);
      }

      sections.push(`\n## 🛠️ 技术栈\n\n- ${techStack}\n`);

      if (topLevel.length > 0) {
        sections.push(`## 📁 项目结构\n\n\`\`\`\n${topLevel.join("\n")}\n\`\`\`\n`);
      }

      sections.push(`## 🚀 快速开始\n`);
      if (fs.existsSync(pkgPath)) {
        sections.push(`\`\`\`bash\n# 安装依赖\nnpm install\n`);
        if (scripts.dev) sections.push(`# 开发模式\nnpm run dev\n`);
        if (scripts.build) sections.push(`# 构建\nnpm run build\n`);
        if (scripts.start) sections.push(`# 启动\nnpm start\n`);
        sections.push(`\`\`\`\n`);
      } else if (fs.existsSync(pyPath)) {
        sections.push(`\`\`\`bash\npip install -r requirements.txt\npython main.py\n\`\`\`\n`);
      } else if (fs.existsSync(goPath)) {
        sections.push(`\`\`\`bash\ngo mod download\ngo run .\n\`\`\`\n`);
      }

      if (deps.length > 0) {
        sections.push(`## 📦 主要依赖\n`);
        for (const d of deps.slice(0, 15)) sections.push(`- \`${d}\``);
        if (deps.length > 15) sections.push(`- ... 共 ${deps.length} 个`);
        sections.push("");
      }

      if (projLicense) sections.push(`## 📄 许可证\n\n${projLicense}\n`);

      const readme = sections.join("\n");
      const outputPath = savePath || path.join(projectPath, "README.md");
      fs.writeFileSync(outputPath, readme, "utf-8");

      let msg = `✅ README.md 已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📝 项目: ${projName}\n🛠️ 技术栈: ${techStack}\n`;
      msg += `📊 章节: ${sections.filter((s) => s.startsWith("## ")).length}个\n`;
      msg += `📁 保存: ${outputPath}`;

      return { success: true, message: msg, data: { path: outputPath, name: projName } };
    } catch (err) {
      return { success: false, message: `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
