import { NextResponse } from "next/server";
import { downloadRemoteSkill } from "@/lib/skill-remote";
import { saveUserSkill } from "@/lib/skill-store";
import { validateSkillConfig } from "@/skills/schema";
import { invalidateCommunityCache } from "@/skills/registry";

function isChina(): boolean {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz.startsWith("Asia/Shanghai") || tz.startsWith("Asia/Chongqing") || tz.startsWith("Asia/Harbin");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "install_community") {
      const { skillName, deps } = body;
      if (!skillName) {
        return NextResponse.json({ success: false, message: "缺少 skillName" }, { status: 400 });
      }

      const results: string[] = [];

      if (deps && Array.isArray(deps) && deps.length > 0) {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(execFile);

        const china = isChina();
        const npmArgs = china
          ? ["install", "--save", "--registry=https://registry.npmmirror.com", ...deps]
          : ["install", "--save", ...deps];

        try {
          const { stdout, stderr } = await execAsync("npm", npmArgs, {
            timeout: 120000,
            cwd: process.cwd(),
            windowsHide: true,
          });
          results.push(`npm install: ${(stdout + stderr).trim().slice(0, 500)}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push(`npm install 失败: ${msg.slice(0, 500)}`);
        }
      }

      invalidateCommunityCache();

      return NextResponse.json({
        success: true,
        message: `技能 ${skillName} 已就绪`,
        installLog: results,
        mirror: isChina() ? "npmmirror.com" : "npmjs.org",
      });
    }

    if (body.action === "uninstall_community") {
      const { skillName, dir } = body;
      if (!skillName || !dir) {
        return NextResponse.json({ success: false, message: "缺少 skillName/dir" }, { status: 400 });
      }

      const fs = await import("fs");
      const path = await import("path");
      const skillDir = path.join(process.cwd(), "src", "skills", "community", dir);
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
        invalidateCommunityCache();
        return NextResponse.json({ success: true, message: `技能 ${skillName} 已卸载` });
      }
      return NextResponse.json({ success: false, message: "技能目录不存在" });
    }

    if (body.action === "list_community") {
      const fs = await import("fs");
      const path = await import("path");
      const communityDir = path.join(process.cwd(), "src", "skills", "community");
      const manifestPath = path.join(communityDir, "skills-manifest.json");

      if (!fs.existsSync(manifestPath)) {
        return NextResponse.json({ success: true, available: [], installed: [] });
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const installed: string[] = [];

      for (const skill of manifest.skills) {
        const indexPath = path.join(communityDir, skill.dir, "index.ts");
        if (fs.existsSync(indexPath)) installed.push(skill.name);
      }

      return NextResponse.json({
        success: true,
        available: manifest.skills,
        installed,
        mirrors: manifest.mirrors,
      });
    }

    const { url, config } = body;

    if (config) {
      const validation = validateSkillConfig(config);
      if (!validation.success) {
        return NextResponse.json(
          { success: false, message: "技能配置校验失败", errors: validation.errors },
          { status: 400 }
        );
      }
      await saveUserSkill(validation.data);
      return NextResponse.json({ success: true, skill: validation.data });
    }

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { success: false, message: "请提供技能 URL 或 config" },
        { status: 400 }
      );
    }

    const skill = await downloadRemoteSkill(url);
    if (!skill) {
      return NextResponse.json(
        { success: false, message: "无法下载或解析远程技能" },
        { status: 422 }
      );
    }

    await saveUserSkill(skill);
    return NextResponse.json({ success: true, skill });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `安装失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
