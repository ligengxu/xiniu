import { NextResponse } from "next/server";
import { getAllSkillsMeta } from "@/skills/registry";

export async function GET() {
  const skills = await getAllSkillsMeta();
  return NextResponse.json(skills);
}
