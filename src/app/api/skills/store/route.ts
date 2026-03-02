import { NextResponse } from "next/server";
import { loadStoreIndex } from "@/lib/skill-store";
import { fetchRemoteSkillIndex } from "@/lib/skill-remote";

export async function GET() {
  try {
    const localIndex = await loadStoreIndex();

    let remoteIndex: unknown[] = [];
    try {
      remoteIndex = await fetchRemoteSkillIndex();
    } catch {
      // remote fetch failure is non-critical
    }

    const merged = mergeIndexes(localIndex, remoteIndex);
    return NextResponse.json({ success: true, skills: merged });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}

function mergeIndexes(local: unknown[], remote: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const item of [...local, ...remote]) {
    const name = (item as { name?: string })?.name;
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(item);
    }
  }

  return result;
}
