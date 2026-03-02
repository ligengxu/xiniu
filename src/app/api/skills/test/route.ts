import { NextResponse } from "next/server";
import { getAllSkillsWithUser } from "@/skills/registry";

export async function POST(req: Request) {
  try {
    const { skillName, params, providerId = "", modelId = "" } = await req.json();
    const skills = await getAllSkillsWithUser(providerId, modelId);
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
      return NextResponse.json({ success: false, message: `Skill "${skillName}" not found` }, { status: 404 });
    }

    const start = Date.now();
    const result = await skill.execute(params || {});
    const elapsed = Date.now() - start;

    return NextResponse.json({ ...result, elapsed });
  } catch (err) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
