export const DEFAULT_TIKTOK_BUCKETS = [100, 1_000, 5_000, 10_000, 20_000, 50_000, 100_000, 500_000, Infinity];

export const CATEGORY_PROFILES = {
  "world-of-tanks": {
    aliases: ["wot", "world_of_tanks", "world-of-tanks", "14"],
    labels: {
      top_count: "Топы",
      premium_count: "Премы",
      gold: "Золото",
      tanks: "Ценные танки",
      region: "Регион",
      email_access: "Доступ к почте",
      phone_linked: "Привязка",
      last_activity: "Последний актив"
    },
    weights: { tanks: 3.5, email_access: 2.8, region: 2.5, top_count: 2.4, gold: 1.8, phone_linked: 1.3, premium_count: 0.7, last_activity: 0.7 },
    hardFields: ["region", "email_access"],
    requiredDataFields: ["top_count", "premium_count"],
    requiredOverlapFields: ["tanks"]
  },
  tiktok: {
    aliases: ["tik-tok", "tik_tok", "tiktok", "20"],
    labels: { followers: "Подписчики", cookie_login: "Cookie", live: "Стримы", phone_linked: "Телефон" },
    weights: { followers: 4, cookie_login: 1.8, live: 0.8, phone_linked: 0.5 },
    hardFields: ["cookie_login"]
  },
  telegram: {
    aliases: ["tg", "telegram", "24"],
    labels: { inactivity_days: "Отлега", spam_block: "Спамблок", country: "Страна", sessions: "Сессии" },
    weights: { spam_block: 3, inactivity_days: 2.5, country: 0.8, sessions: 0.4 },
    hardFields: ["spam_block"]
  },
  steam: {
    aliases: ["steam"],
    labels: {
      banned: "Блокировки",
      email_access: "Доступ к почте",
      inventory_value: "Оценка инвентаря",
      games_count: "Количество игр",
      level: "Уровень Steam",
      country: "Страна"
    },
    weights: { banned: 4, email_access: 2.5, inventory_value: 1 },
    hardFields: ["banned"],
    requiredDataFields: [],
    requiredOverlapFields: []
  },
  minecraft: {
    aliases: ["minecraft"],
    labels: { banned: "Баны", email_relinked: "Почта перевязана", capes: "Плащи", hypixel_level: "Hypixel" },
    weights: { banned: 3, email_relinked: 2.5, capes: 2.2, hypixel_level: 1.5 },
    hardFields: ["banned", "email_relinked"]
  }
};

export function resolveProfile(category) {
  const value = String(category ?? "").toLowerCase();
  return Object.entries(CATEGORY_PROFILES).find(([, profile]) => profile.aliases.includes(value))?.[1] ?? {
    aliases: [value], labels: {}, weights: {}, hardFields: [], requiredDataFields: [], requiredOverlapFields: []
  };
}

export function canonicalCategory(category) {
  const value = String(category ?? "unknown").toLowerCase();
  return Object.entries(CATEGORY_PROFILES).find(([, profile]) => profile.aliases.includes(value))?.[0] ?? value;
}

export function tiktokBucket(value, buckets = DEFAULT_TIKTOK_BUCKETS) {
  const followers = Number(value) || 0;
  let lower = 0;
  for (const upper of buckets) {
    if (followers < upper) return [lower, upper];
    lower = upper;
  }
  return [lower, Infinity];
}
