// 实时天气：Open-Meteo（免费、无需 key）。离线/失败 → 晴天兜底。
const URL_ = lat => lon => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=Asia%2FShanghai&wind_speed_unit=ms`;
const WMO = { 0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '小阵雨', 81: '阵雨', 82: '暴雨', 85: '阵雪', 86: '大阵雪', 95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴' };
export const CLEAR = { ok: false, text: '晴（离线兜底）', temp: null, feels: null, hum: null, cloud: 8, rain: 0, snow: false, snowAmt: 0, fog: false, wind: 2, windDir: 90, gust: null, code: 0, source: 'fallback' };
export function parse(c) {
  const code = c.weather_code, precip = (c.rain || 0) + (c.showers || 0) + ((c.precipitation || 0) - (c.rain || 0) - (c.showers || 0) - (c.snowfall || 0) > 0 ? 0 : 0);
  const rainmm = Math.max(c.rain || 0, c.showers || 0, (c.precipitation || 0) - (c.snowfall || 0) * 0.7);
  return { ok: true, text: WMO[code] || '—', temp: c.temperature_2m, feels: c.apparent_temperature, hum: c.relative_humidity_2m, cloud: c.cloud_cover ?? 0, rain: Math.max(0, rainmm),
    snow: (c.snowfall || 0) > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86, snowAmt: (c.snowfall || 0) / 2, fog: code === 45 || code === 48, wind: c.wind_speed_10m ?? 0, windDir: c.wind_direction_10m ?? 0,
    gust: c.wind_gusts_10m, code, time: c.time, source: 'Open-Meteo' };
}
export async function fetchWeather(lat, lon, timeout = 7000) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeout);
  try { const r = await fetch(URL_(lat)(lon), { signal: ac.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); if (!j.current) throw new Error('no current'); return parse(j.current); }
  finally { clearTimeout(tm); }
}
// 手动天气预设（按 Y 键切换）
export const PRESETS = [
  { name: '实时', real: true },
  { name: '晴', v: { ...CLEAR, text: '晴（手动）', cloud: 5, source: 'manual' } },
  { name: '多云', v: { ...CLEAR, text: '多云（手动）', cloud: 65, source: 'manual' } },
  { name: '雨', v: { ...CLEAR, text: '中雨（手动）', cloud: 95, rain: 2.6, wind: 6, windDir: 80, source: 'manual' } },
  { name: '雾', v: { ...CLEAR, text: '大雾（手动）', cloud: 70, fog: true, source: 'manual' } },
  { name: '雪', v: { ...CLEAR, text: '中雪（手动）', cloud: 90, snow: true, snowAmt: .5, wind: 2, source: 'manual' } },
];
export const windDirName = d => ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(((d % 360) + 360) % 360 / 45) % 8] + '风';
