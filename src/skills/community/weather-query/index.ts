import { z } from "zod";
import type { SkillDefinition } from "../types";

interface WeatherData {
  city: string;
  temp: string;
  humidity: string;
  wind: string;
  desc: string;
  forecast?: Array<{ date: string; high: string; low: string; desc: string }>;
}

async function fetchWeather(city: string): Promise<{ ok: boolean; data?: WeatherData; error?: string }> {
  const apis = [
    {
      name: "wttr.in",
      fetch: async (): Promise<WeatherData | null> => {
        const resp = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
          headers: { "User-Agent": "curl/7.68.0" },
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return null;
        const data = await resp.json() as {
          current_condition?: Array<{
            temp_C?: string; humidity?: string; windspeedKmph?: string; winddir16Point?: string;
            lang_zh?: Array<{ value?: string }>; weatherDesc?: Array<{ value?: string }>;
          }>;
          nearest_area?: Array<{ areaName?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>;
          weather?: Array<{
            date?: string; maxtempC?: string; mintempC?: string;
            hourly?: Array<{ lang_zh?: Array<{ value?: string }>; weatherDesc?: Array<{ value?: string }> }>;
          }>;
        };
        if (!data.current_condition?.[0]) return null;
        const cur = data.current_condition[0];
        const area = data.nearest_area?.[0];

        const forecast = data.weather?.slice(0, 5).map((d) => ({
          date: d.date || "",
          high: (d.maxtempC || "?") + "°C",
          low: (d.mintempC || "?") + "°C",
          desc: d.hourly?.[4]?.lang_zh?.[0]?.value || d.hourly?.[4]?.weatherDesc?.[0]?.value || "",
        }));

        return {
          city: area?.areaName?.[0]?.value || city,
          temp: (cur.temp_C || "?") + "°C",
          humidity: (cur.humidity || "?") + "%",
          wind: `${cur.winddir16Point || ""} ${cur.windspeedKmph || "?"}km/h`,
          desc: cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || "",
          forecast,
        };
      },
    },
    {
      name: "open-meteo",
      fetch: async (): Promise<WeatherData | null> => {
        const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!geoResp.ok) return null;
        const geoData = await geoResp.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> };
        if (!geoData.results?.[0]) return null;
        const { latitude, longitude, name } = geoData.results[0];

        const weatherResp = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=5`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!weatherResp.ok) return null;
        const w = await weatherResp.json() as {
          current?: { temperature_2m?: number; relative_humidity_2m?: number; wind_speed_10m?: number; weather_code?: number };
          daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; weather_code?: number[] };
        };
        if (!w.current) return null;

        const wmoDesc: Record<number, string> = {
          0: "晴", 1: "大部晴", 2: "多云", 3: "阴天",
          45: "雾", 48: "霜雾", 51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
          61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "大冻雨",
          71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
          80: "小阵雨", 81: "中阵雨", 82: "大阵雨",
          85: "小阵雪", 86: "大阵雪",
          95: "雷暴", 96: "雷暴冰雹", 99: "强雷暴冰雹",
        };

        const forecast = w.daily?.time?.map((date, i) => ({
          date,
          high: (w.daily?.temperature_2m_max?.[i]?.toFixed(0) || "?") + "°C",
          low: (w.daily?.temperature_2m_min?.[i]?.toFixed(0) || "?") + "°C",
          desc: wmoDesc[w.daily?.weather_code?.[i] ?? -1] || "未知",
        }));

        return {
          city: name,
          temp: (w.current.temperature_2m?.toFixed(0) || "?") + "°C",
          humidity: (w.current.relative_humidity_2m || "?") + "%",
          wind: (w.current.wind_speed_10m?.toFixed(0) || "?") + "km/h",
          desc: wmoDesc[w.current.weather_code ?? -1] || "未知",
          forecast,
        };
      },
    },
  ];

  for (const api of apis) {
    try {
      const result = await api.fetch();
      if (result) return { ok: true, data: result };
    } catch {
      continue;
    }
  }

  return { ok: false, error: "所有天气API均不可用" };
}

export const weatherQuerySkill: SkillDefinition = {
  name: "weather_query",
  displayName: "天气查询",
  description: "查询任意城市的实时天气和未来5天预报。支持中文城市名（如'北京'、'上海'）和英文（如'Tokyo'、'London'）。用户说'天气'、'查天气'、'今天天气怎么样'、'weather'时使用。",
  icon: "Sparkles",
  category: "life",
  parameters: z.object({
    city: z.string().describe("城市名称（中文或英文，如'北京'、'Tokyo'、'New York'）"),
  }),
  execute: async (params) => {
    const { city } = params as { city: string };

    if (!city || city.trim().length === 0) {
      return { success: false, message: "请提供城市名称" };
    }

    try {
      const result = await fetchWeather(city);

      if (!result.ok || !result.data) {
        return { success: false, message: result.error || `无法获取 ${city} 的天气数据` };
      }

      const d = result.data;
      let msg = `${d.city} 当前天气\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `天气: ${d.desc}\n`;
      msg += `温度: ${d.temp}\n`;
      msg += `湿度: ${d.humidity}\n`;
      msg += `风力: ${d.wind}\n`;

      if (d.forecast && d.forecast.length > 0) {
        msg += `\n未来预报:\n`;
        for (const f of d.forecast) {
          msg += `  ${f.date}: ${f.desc} ${f.low}~${f.high}\n`;
        }
      }

      return {
        success: true, message: msg,
        data: { city: d.city, temp: d.temp, humidity: d.humidity, wind: d.wind, desc: d.desc, forecast: d.forecast },
      };
    } catch (err) {
      return { success: false, message: `天气查询异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
