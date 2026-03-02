import { NextResponse } from "next/server";
import { getUserSkill } from "@/lib/skill-store";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");

  if (!name) {
    return NextResponse.json(
      { success: false, message: "缺少参数 name" },
      { status: 400 }
    );
  }

  try {
    const skill = await getUserSkill(name);
    if (!skill) {
      return NextResponse.json(
        { success: false, message: `技能 "${name}" 不存在` },
        { status: 404 }
      );
    }

    const json = JSON.stringify(skill, null, 2);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${name}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}
