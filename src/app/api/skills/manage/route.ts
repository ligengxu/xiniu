import { NextResponse } from "next/server";
import { getAllSkillsMeta } from "@/skills/registry";
import { validateSkillConfig } from "@/skills/schema";
import {
  loadUserSkills,
  saveUserSkill,
  deleteUserSkill,
  getUserSkill,
} from "@/lib/skill-store";

export async function GET() {
  try {
    const allMeta = await getAllSkillsMeta();
    return NextResponse.json({ success: true, skills: allMeta });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validation = validateSkillConfig(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, errors: validation.errors },
        { status: 400 }
      );
    }

    const config = validation.data;

    const builtinNames = (await getAllSkillsMeta())
      .filter((s) => s.source === "builtin")
      .map((s) => s.name);

    if (builtinNames.includes(config.name)) {
      return NextResponse.json(
        { success: false, message: `"${config.name}" 与内置技能名冲突` },
        { status: 409 }
      );
    }

    await saveUserSkill(config);
    return NextResponse.json({ success: true, skill: config });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const validation = validateSkillConfig(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, errors: validation.errors },
        { status: 400 }
      );
    }

    const config = validation.data;
    const existing = await getUserSkill(config.name);
    if (!existing) {
      return NextResponse.json(
        { success: false, message: `用户技能 "${config.name}" 不存在` },
        { status: 404 }
      );
    }

    config.createdAt = existing.createdAt;
    await saveUserSkill(config);
    return NextResponse.json({ success: true, skill: config });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json(
        { success: false, message: "缺少参数 name" },
        { status: 400 }
      );
    }

    const deleted = await deleteUserSkill(name);
    if (!deleted) {
      return NextResponse.json(
        { success: false, message: `技能 "${name}" 不存在` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: `已删除技能 "${name}"` });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}
