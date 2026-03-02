import { NextResponse } from "next/server";
import { getAllSkillsMeta } from "@/skills/registry";
import {
  saveCredential,
  listCredentials,
  type CredentialType,
} from "@/lib/credential-store";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  try {
    if (action === "guides") {
      const allMeta = await getAllSkillsMeta();
      const withGuides = allMeta
        .filter((s) => s.setupGuide)
        .map((s) => ({
          name: s.name,
          displayName: s.displayName,
          icon: s.icon,
          category: s.category,
          setupGuide: s.setupGuide,
        }));
      return NextResponse.json({ success: true, skills: withGuides });
    }

    if (action === "credentials") {
      const type = (searchParams.get("type") || "api") as CredentialType;
      const saved = await listCredentials(type);
      return NextResponse.json({ success: true, credentials: saved });
    }

    return NextResponse.json({ success: false, message: "未知 action" }, { status: 400 });
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
    const { action } = body;

    if (action === "install") {
      const { command, useMirror } = body;
      if (!command) {
        return NextResponse.json({ success: false, message: "缺少 command" }, { status: 400 });
      }

      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(execFile);

      const cmd = useMirror && body.mirrorCommand ? body.mirrorCommand : command;
      const parts = cmd.split(" ");
      const bin = parts[0];
      const args = parts.slice(1);

      try {
        const { stdout, stderr } = await execAsync(bin, args, {
          timeout: 120000,
          windowsHide: true,
          env: { ...process.env },
        });
        return NextResponse.json({
          success: true,
          message: "安装完成",
          output: (stdout + "\n" + stderr).trim().slice(0, 3000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({
          success: false,
          message: `安装失败: ${msg.slice(0, 1000)}`,
        });
      }
    }

    if (action === "credential") {
      const { type, label, host, username, password, extra } = body;
      if (!type || !username) {
        return NextResponse.json({ success: false, message: "缺少 type/username" }, { status: 400 });
      }
      const saved = await saveCredential({
        type: type as CredentialType,
        label: label || `${type} credential`,
        host: host || "",
        username,
        password: password || "",
        extra,
      });
      return NextResponse.json({ success: true, id: saved.id, message: "凭证已保存" });
    }

    if (action === "check") {
      const { skillName, checkAction, params } = body;
      if (!skillName) {
        return NextResponse.json({ success: false, message: "缺少 skillName" }, { status: 400 });
      }

      const { builtinSkills } = await import("@/skills/registry");
      const skill = builtinSkills.find((s: { name: string }) => s.name === skillName);
      if (!skill) {
        return NextResponse.json({ success: false, message: `未找到技能: ${skillName}` });
      }

      const result = await skill.execute({ action: checkAction || "check_status", ...params });
      return NextResponse.json({ success: result.success, message: result.message, data: result.data });
    }

    return NextResponse.json({ success: false, message: "未知 action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 },
    );
  }
}
