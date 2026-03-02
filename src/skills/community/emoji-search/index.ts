import { z } from "zod";
import type { SkillDefinition } from "../types";

const EMOJI_DB: Array<{ emoji: string; name: string; keywords: string[] }> = [
  { emoji: "😀", name: "笑脸", keywords: ["开心", "高兴", "笑", "smile", "happy"] },
  { emoji: "😂", name: "笑哭", keywords: ["搞笑", "爆笑", "哈哈", "laugh", "cry"] },
  { emoji: "🥰", name: "喜爱", keywords: ["爱", "喜欢", "心", "love", "adore"] },
  { emoji: "😎", name: "墨镜", keywords: ["酷", "帅", "cool", "sunglasses"] },
  { emoji: "🤔", name: "思考", keywords: ["想", "考虑", "疑问", "think"] },
  { emoji: "😭", name: "大哭", keywords: ["伤心", "难过", "哭", "sad", "cry"] },
  { emoji: "😡", name: "生气", keywords: ["愤怒", "气", "angry", "mad"] },
  { emoji: "🥺", name: "求求", keywords: ["可怜", "委屈", "please", "beg"] },
  { emoji: "😴", name: "睡觉", keywords: ["困", "睡", "sleep", "tired"] },
  { emoji: "🤮", name: "呕吐", keywords: ["恶心", "吐", "sick", "vomit"] },
  { emoji: "👍", name: "赞", keywords: ["好", "可以", "棒", "thumbs up", "good", "nice"] },
  { emoji: "👎", name: "踩", keywords: ["差", "不好", "thumbs down", "bad"] },
  { emoji: "👏", name: "鼓掌", keywords: ["掌声", "表扬", "clap", "bravo"] },
  { emoji: "🙏", name: "合十", keywords: ["谢谢", "感谢", "拜托", "pray", "thanks"] },
  { emoji: "💪", name: "加油", keywords: ["力量", "强", "muscle", "strong", "power"] },
  { emoji: "❤️", name: "红心", keywords: ["爱", "心", "喜欢", "heart", "love", "red"] },
  { emoji: "💔", name: "心碎", keywords: ["伤心", "分手", "broken heart"] },
  { emoji: "🔥", name: "火", keywords: ["热", "火爆", "火", "fire", "hot", "lit"] },
  { emoji: "⭐", name: "星星", keywords: ["星", "收藏", "star", "favorite"] },
  { emoji: "🎉", name: "庆祝", keywords: ["派对", "庆祝", "恭喜", "party", "celebrate"] },
  { emoji: "🎵", name: "音符", keywords: ["音乐", "歌", "music", "song"] },
  { emoji: "📱", name: "手机", keywords: ["电话", "手机", "phone", "mobile"] },
  { emoji: "💻", name: "电脑", keywords: ["笔记本", "电脑", "laptop", "computer"] },
  { emoji: "🏠", name: "房子", keywords: ["家", "房", "home", "house"] },
  { emoji: "🚗", name: "汽车", keywords: ["车", "开车", "car", "drive"] },
  { emoji: "✈️", name: "飞机", keywords: ["航班", "旅行", "plane", "flight", "travel"] },
  { emoji: "🌍", name: "地球", keywords: ["世界", "全球", "earth", "world", "globe"] },
  { emoji: "☀️", name: "太阳", keywords: ["晴天", "阳光", "sun", "sunny"] },
  { emoji: "🌙", name: "月亮", keywords: ["晚上", "夜", "moon", "night"] },
  { emoji: "⚡", name: "闪电", keywords: ["快", "电", "lightning", "fast", "power"] },
  { emoji: "💰", name: "钱袋", keywords: ["钱", "金钱", "money", "cash"] },
  { emoji: "🎯", name: "靶心", keywords: ["目标", "精准", "target", "goal"] },
  { emoji: "✅", name: "勾选", keywords: ["完成", "对", "check", "done", "correct"] },
  { emoji: "❌", name: "叉号", keywords: ["错误", "关闭", "wrong", "close", "no"] },
  { emoji: "⚠️", name: "警告", keywords: ["注意", "警告", "warning", "alert"] },
  { emoji: "🚀", name: "火箭", keywords: ["发射", "快速", "rocket", "launch", "fast"] },
  { emoji: "🐛", name: "虫子", keywords: ["bug", "错误", "调试", "debug"] },
  { emoji: "📝", name: "备忘", keywords: ["记录", "笔记", "memo", "note", "write"] },
  { emoji: "📦", name: "包裹", keywords: ["打包", "包", "package", "box"] },
  { emoji: "🔒", name: "锁", keywords: ["安全", "锁", "lock", "secure", "private"] },
  { emoji: "🔑", name: "钥匙", keywords: ["密钥", "key", "password"] },
  { emoji: "🗑️", name: "垃圾桶", keywords: ["删除", "清除", "trash", "delete"] },
  { emoji: "📊", name: "图表", keywords: ["数据", "统计", "chart", "data", "stats"] },
  { emoji: "🎨", name: "调色板", keywords: ["设计", "颜色", "art", "design", "color", "palette"] },
  { emoji: "🍕", name: "披萨", keywords: ["食物", "pizza", "food"] },
  { emoji: "☕", name: "咖啡", keywords: ["饮料", "咖啡", "coffee", "drink"] },
  { emoji: "🎂", name: "蛋糕", keywords: ["生日", "cake", "birthday"] },
  { emoji: "🐱", name: "猫", keywords: ["猫咪", "cat", "kitten"] },
  { emoji: "🐶", name: "狗", keywords: ["狗狗", "dog", "puppy"] },
  { emoji: "🌸", name: "樱花", keywords: ["花", "春天", "cherry blossom", "flower", "spring"] },
];

export const emojiSearchSkill: SkillDefinition = {
  name: "emoji_search",
  displayName: "表情符号搜索",
  description:
    "搜索表情符号Emoji，支持中文和英文关键词。方便快速找到需要的表情。" +
    "用户说'表情'、'emoji'、'找表情'、'表情符号'时使用。",
  icon: "Smile",
  category: "life",
  parameters: z.object({
    keyword: z.string().describe("搜索关键词（如'开心'、'fire'、'爱'）"),
  }),
  execute: async (params) => {
    const { keyword } = params as { keyword: string };
    if (!keyword?.trim()) return { success: false, message: "❌ 请提供搜索关键词" };

    const kw = keyword.toLowerCase();
    const results = EMOJI_DB.filter((e) =>
      e.name.includes(kw) || e.keywords.some((k) => k.includes(kw)) || e.emoji === keyword
    );

    if (results.length === 0) {
      return { success: true, message: `🔍 未找到匹配 "${keyword}" 的表情\n\n💡 试试: 开心、爱、火、star、music` };
    }

    let msg = `🔍 搜索 "${keyword}" (${results.length}个)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const e of results) {
      msg += `${e.emoji}  ${e.name}  (${e.keywords.slice(0, 3).join(", ")})\n`;
    }
    msg += `\n💡 直接复制表情即可使用`;

    return { success: true, message: msg, data: { results: results.map((e) => ({ emoji: e.emoji, name: e.name })) as unknown as Record<string, unknown>[] } };
  },
};
