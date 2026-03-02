export interface Command {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "navigation" | "skill" | "setting" | "action";
  action: () => void;
  keywords?: string[];
}

let commandRegistry: Command[] = [];
let usageCounts: Record<string, number> = {};

try {
  const stored = typeof window !== "undefined" ? localStorage.getItem("xiniu-cmd-usage") : null;
  if (stored) usageCounts = JSON.parse(stored);
} catch { /* noop */ }

export function registerCommands(commands: Command[]) {
  commandRegistry = commands;
}

export function getCommands(): Command[] {
  return [...commandRegistry].sort((a, b) => {
    const aCount = usageCounts[a.id] || 0;
    const bCount = usageCounts[b.id] || 0;
    return bCount - aCount;
  });
}

export function recordCommandUsage(commandId: string) {
  usageCounts[commandId] = (usageCounts[commandId] || 0) + 1;
  try {
    localStorage.setItem("xiniu-cmd-usage", JSON.stringify(usageCounts));
  } catch { /* noop */ }
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function searchCommands(query: string): Command[] {
  if (!query.trim()) return getCommands();
  return getCommands().filter(
    (cmd) =>
      fuzzyMatch(query, cmd.name) ||
      fuzzyMatch(query, cmd.description) ||
      cmd.keywords?.some((kw) => fuzzyMatch(query, kw))
  );
}
