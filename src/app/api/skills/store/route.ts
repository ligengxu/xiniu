import { NextResponse } from "next/server";
import path from "path";

const GITHUB_RAW = process.env.XINIU_SKILL_SOURCE
  || "https://raw.githubusercontent.com/ligengxu/xiniu/community-skills/src/skills/community";

function isChina(): boolean {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz.startsWith("Asia/Shanghai") || tz.startsWith("Asia/Chongqing") || tz.startsWith("Asia/Harbin");
}

interface ManifestSkill {
  name: string;
  dir: string;
  displayName: string;
  icon: string;
  category: string;
  deps: string[];
  description: string;
}

async function readManifest(): Promise<{ skills: ManifestSkill[]; mirrors: Record<string, Record<string, string>> }> {
  const fs = await import("fs");
  const manifestPath = path.join(process.cwd(), "src", "skills", "community", "skills-manifest.json");
  if (!fs.existsSync(manifestPath)) return { skills: [], mirrors: {} };
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

function getInstalledSkills(): string[] {
  const fs = require("fs") as typeof import("fs");
  const communityDir = path.join(process.cwd(), "src", "skills", "community");
  if (!fs.existsSync(communityDir)) return [];
  const entries = fs.readdirSync(communityDir, { withFileTypes: true });
  const installed: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (fs.existsSync(path.join(communityDir, e.name, "index.ts"))) {
      installed.push(e.name);
    }
  }
  return installed;
}

export async function GET() {
  try {
    const manifest = await readManifest();
    const installedDirs = getInstalledSkills();

    const skills = manifest.skills.map((s) => ({
      ...s,
      installed: installedDirs.includes(s.dir),
      source: "community" as const,
    }));

    return NextResponse.json({
      success: true,
      skills,
      mirrors: manifest.mirrors,
      region: isChina() ? "china" : "global",
      totalInstalled: skills.filter((s) => s.installed).length,
      totalAvailable: skills.length,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, skillDir, skillName, deps } = body;

    if (action === "install") {
      if (!skillDir || !skillName) {
        return NextResponse.json({ success: false, message: "缺少 skillDir/skillName" }, { status: 400 });
      }

      const fs = await import("fs");
      const communityDir = path.join(process.cwd(), "src", "skills", "community");
      const skillPath = path.join(communityDir, skillDir);

      if (fs.existsSync(path.join(skillPath, "index.ts"))) {
        return NextResponse.json({ success: true, message: `${skillName} 已安装`, phase: "done" });
      }

      fs.mkdirSync(skillPath, { recursive: true });

      const sourceUrl = `${GITHUB_RAW}/${skillDir}/index.ts`;
      const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) {
        fs.rmSync(skillPath, { recursive: true, force: true });
        return NextResponse.json({
          success: false,
          message: `下载失败 (HTTP ${resp.status})，请检查网络或技能是否已上传到仓库`,
        });
      }

      const code = await resp.text();
      fs.writeFileSync(path.join(skillPath, "index.ts"), code, "utf-8");

      const installResults: string[] = [];
      if (deps && Array.isArray(deps) && deps.length > 0) {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(execFile);

        const china = isChina();
        const npmArgs = china
          ? ["install", "--save", `--registry=https://registry.npmmirror.com`, ...deps]
          : ["install", "--save", ...deps];

        try {
          const { stdout, stderr } = await execAsync("npm", npmArgs, {
            timeout: 120000,
            cwd: process.cwd(),
            windowsHide: true,
          });
          installResults.push((stdout + "\n" + stderr).trim().slice(0, 800));
        } catch (err) {
          installResults.push(`依赖安装失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const { invalidateCommunityCache } = await import("@/skills/registry");
      invalidateCommunityCache();

      return NextResponse.json({
        success: true,
        message: `${skillName} 安装成功`,
        phase: "done",
        deps: deps || [],
        depsLog: installResults,
        mirror: isChina() ? "npmmirror.com" : "npmjs.org",
      });
    }

    if (action === "uninstall") {
      if (!skillDir) {
        return NextResponse.json({ success: false, message: "缺少 skillDir" }, { status: 400 });
      }

      const fs = await import("fs");
      const skillPath = path.join(process.cwd(), "src", "skills", "community", skillDir);
      if (fs.existsSync(skillPath)) {
        fs.rmSync(skillPath, { recursive: true, force: true });
        const { invalidateCommunityCache } = await import("@/skills/registry");
        invalidateCommunityCache();
        return NextResponse.json({ success: true, message: `${skillName || skillDir} 已卸载` });
      }
      return NextResponse.json({ success: false, message: "技能目录不存在" });
    }

    if (action === "install_all") {
      const manifest = await readManifest();
      const fs = await import("fs");
      const communityDir = path.join(process.cwd(), "src", "skills", "community");
      const results: { name: string; ok: boolean; msg: string }[] = [];
      const allDeps = new Set<string>();

      for (const skill of manifest.skills) {
        const skillPath = path.join(communityDir, skill.dir);
        if (fs.existsSync(path.join(skillPath, "index.ts"))) {
          results.push({ name: skill.name, ok: true, msg: "已安装" });
          continue;
        }
        try {
          fs.mkdirSync(skillPath, { recursive: true });
          const resp = await fetch(`${GITHUB_RAW}/${skill.dir}/index.ts`, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          fs.writeFileSync(path.join(skillPath, "index.ts"), await resp.text(), "utf-8");
          results.push({ name: skill.name, ok: true, msg: "已下载" });
          for (const d of skill.deps) allDeps.add(d);
        } catch (err) {
          results.push({ name: skill.name, ok: false, msg: err instanceof Error ? err.message : String(err) });
        }
      }

      if (allDeps.size > 0) {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(execFile);
        const china = isChina();
        const args = china
          ? ["install", "--save", `--registry=https://registry.npmmirror.com`, ...Array.from(allDeps)]
          : ["install", "--save", ...Array.from(allDeps)];
        try {
          await execAsync("npm", args, { timeout: 180000, cwd: process.cwd(), windowsHide: true });
        } catch { /* best effort */ }
      }

      const { invalidateCommunityCache } = await import("@/skills/registry");
      invalidateCommunityCache();

      const ok = results.filter((r) => r.ok).length;
      return NextResponse.json({
        success: true,
        message: `批量安装完成: ${ok}/${results.length} 成功`,
        results,
      });
    }

    return NextResponse.json({ success: false, message: "未知 action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 },
    );
  }
}
