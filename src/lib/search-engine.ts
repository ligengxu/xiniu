export interface SearchResult {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  content: string;
  matchStart: number;
  matchEnd: number;
  role: "user" | "assistant";
  timestamp: number;
}

export function searchMessages(
  sessions: Array<{
    id: string;
    title: string;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp?: number;
    }>;
  }>,
  query: string,
  options?: { sessionId?: string; maxResults?: number }
): SearchResult[] {
  const results: SearchResult[] = [];
  const q = query.toLowerCase();
  const maxResults = options?.maxResults || 50;

  const targetSessions = options?.sessionId
    ? sessions.filter((s) => s.id === options.sessionId)
    : sessions;

  for (const session of targetSessions) {
    for (const msg of session.messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const content = msg.content || "";
      const lowerContent = content.toLowerCase();
      const matchStart = lowerContent.indexOf(q);

      if (matchStart !== -1) {
        results.push({
          sessionId: session.id,
          sessionTitle: session.title,
          messageId: msg.id,
          content: content.slice(
            Math.max(0, matchStart - 50),
            Math.min(content.length, matchStart + q.length + 50)
          ),
          matchStart: Math.max(0, matchStart - 50) === 0 ? matchStart : 50,
          matchEnd: Math.max(0, matchStart - 50) === 0
            ? matchStart + q.length
            : 50 + q.length,
          role: msg.role as "user" | "assistant",
          timestamp: msg.timestamp || 0,
        });

        if (results.length >= maxResults) return results;
      }
    }
  }

  return results;
}
