import { httpError } from './security.js';

export const DEFAULT_PROFILE = Object.freeze({ nickname: '', cycleLength: 28, periodLength: 5, reminder: true, reminderDays: 3 });
const FLOWS = new Set(['', '少量', '中等', '较多', '点滴']);
const SYMPTOMS = new Set(['痛经', '腰酸', '头痛', '长痘', '疲惫', '腹胀', '失眠', '恶心', '腹泻', '食欲变化', '水肿']);
const MOODS = new Set(['', '开心', '平静', '低落', '烦躁', '敏感', '焦虑']);
const SLEEP = new Set(['', '很差', '一般', '不错', '很好']);

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

function validDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function sanitizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, '记录格式不正确');
  const rawProfile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const nickname = String(rawProfile.nickname || '').trim().slice(0, 20);
  const profile = {
    nickname,
    cycleLength: clamp(rawProfile.cycleLength, 15, 60, 28),
    periodLength: clamp(rawProfile.periodLength, 1, 14, 5),
    reminder: rawProfile.reminder !== false,
    reminderDays: clamp(rawProfile.reminderDays, 1, 7, 3)
  };
  const entries = Object.entries(input.logs || {});
  if (entries.length > 5000) throw httpError(400, '记录数量超过限制');
  const logs = {};
  for (const [key, rawLog] of entries) {
    if (!validDateKey(key) || !rawLog || typeof rawLog !== 'object') throw httpError(400, `日期 ${key} 的记录格式不正确`);
    const period = Boolean(rawLog.period);
    const flow = FLOWS.has(rawLog.flow) ? rawLog.flow : '';
    const symptoms = [...new Set(Array.isArray(rawLog.symptoms) ? rawLog.symptoms.filter(item => SYMPTOMS.has(item)) : [])].slice(0, 13);
    const mood = MOODS.has(rawLog.mood) ? rawLog.mood : '';
    const painLevel = rawLog.painLevel === null || rawLog.painLevel === undefined || rawLog.painLevel === '' ? null : clamp(rawLog.painLevel, 0, 3, 0);
    const sleep = SLEEP.has(rawLog.sleep) ? rawLog.sleep : '';
    const note = String(rawLog.note || '').trim().slice(0, 200);
    if (period || symptoms.length || mood || painLevel !== null || sleep || note) {
      logs[key] = { period, flow: period ? flow : '', symptoms, mood, painLevel, sleep, note };
    }
  }
  return { profile, logs };
}
