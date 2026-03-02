export interface DialectInfo {
  id: string;
  name: string;
  lang: string;
  voice: string;
  flag: string;
}

export const DIALECT_LIST: DialectInfo[] = [
  {
    id: "mandarin",
    name: "普通话",
    lang: "zh-CN",
    voice: "zh-CN-XiaoxiaoNeural",
    flag: "🇨🇳",
  },
  {
    id: "cantonese",
    name: "粤语（广东话）",
    lang: "zh-HK",
    voice: "zh-HK-HiuGaaiNeural",
    flag: "🏮",
  },
  {
    id: "taiwanese",
    name: "台湾国语",
    lang: "zh-TW",
    voice: "zh-TW-HsiaoChenNeural",
    flag: "🏯",
  },
  {
    id: "sichuanese",
    name: "四川话",
    lang: "zh-CN",
    voice: "zh-CN-XiaoxiaoNeural",
    flag: "🌶️",
  },
  {
    id: "shanghainese",
    name: "上海话（吴语）",
    lang: "zh-CN",
    voice: "zh-CN-XiaoxiaoNeural",
    flag: "🏙️",
  },
  {
    id: "hokkien",
    name: "闽南语",
    lang: "zh-TW",
    voice: "zh-TW-HsiaoChenNeural",
    flag: "🍵",
  },
  {
    id: "english",
    name: "English",
    lang: "en-US",
    voice: "en-US-JennyNeural",
    flag: "🇺🇸",
  },
  {
    id: "japanese",
    name: "日本語",
    lang: "ja-JP",
    voice: "ja-JP-NanamiNeural",
    flag: "🇯🇵",
  },
  {
    id: "korean",
    name: "한국어",
    lang: "ko-KR",
    voice: "ko-KR-SunHiNeural",
    flag: "🇰🇷",
  },
];

export function getDialectById(id: string): DialectInfo {
  return DIALECT_LIST.find((d) => d.id === id) || DIALECT_LIST[0];
}

export function detectAvailableDialects(): DialectInfo[] {
  return DIALECT_LIST;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createRecognition(dialectId?: string): SpeechRecognition | null {
  if (!isSpeechRecognitionSupported()) return null;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;

  const dialect = dialectId ? getDialectById(dialectId) : DIALECT_LIST[0];
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = dialect.lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

// ─── Server-side TTS via edge-tts ────────────────────────────────

let _currentAudio: HTMLAudioElement | null = null;

export type SpeakResult = { ok: true } | { ok: false; reason: string };

export async function speak(
  text: string,
  options?: { rate?: number; dialectId?: string }
): Promise<SpeakResult> {
  stopSpeaking();

  if (!text || !text.trim()) {
    return { ok: false, reason: "没有可朗读的内容" };
  }

  try {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        dialectId: options?.dialectId || "mandarin",
        rate: options?.rate || 1.0,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "TTS 服务异常" }));
      return { ok: false, reason: err.error || `TTS 请求失败 (${resp.status})` };
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    _currentAudio = audio;

    audio.addEventListener("ended", () => {
      URL.revokeObjectURL(url);
      if (_currentAudio === audio) _currentAudio = null;
    });

    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      if (_currentAudio === audio) _currentAudio = null;
    });

    await audio.play();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `语音合成失败: ${msg}` };
  }
}

export function stopSpeaking(): void {
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
    const src = _currentAudio.src;
    _currentAudio = null;
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
  }
}

export function isSpeaking(): boolean {
  return !!_currentAudio && !_currentAudio.paused && !_currentAudio.ended;
}
