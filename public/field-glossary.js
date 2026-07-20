// Field glossary: human-readable Russian names + short hints for common LZT Market
// attributes. This is an i18n dictionary for TECHNICAL FIELD NAMES only. It is NOT
// a pricing preset and carries no valuation logic, so it does not violate the
// "no category-specific knowledge in valuation" principle. It is used purely as a
// display fallback when /params provides no Russian description.
//
// DOM-free so both the browser and Node modules can import it.

export const FIELD_GLOSSARY = {
  // ——— common across categories ———
  origin: { label: "Происхождение", hint: "Как получен аккаунт: регистрация, перекуп, брут и т.п." },
  service: { label: "Сервис или тип аккаунта", hint: "Конкретный сервис, игра или разновидность подписки" },
  autorenewal: { label: "Автопродление", hint: "Продлевается ли подписка автоматически" },
  auto_renewal: { label: "Автопродление", hint: "Продлевается ли подписка автоматически" },
  subscription: { label: "Подписка", hint: "Название или тип действующей подписки" },
  subscription_name: { label: "Название подписки", hint: "Тариф или вид подписки" },
  subscription_length: { label: "Срок подписки", hint: "Сколько времени осталось до окончания подписки" },
  subscription_period: { label: "Единица срока", hint: "В чём указан срок: дни, месяцы или годы" },
  subscription_ends: { label: "Подписка действует до", hint: "Дата окончания оплаченного периода" },
  expires_at: { label: "Действует до", hint: "Дата окончания доступа или подписки" },
  account_type: { label: "Тип аккаунта", hint: "Разновидность аккаунта или уровень доступа" },
  platform: { label: "Платформа", hint: "ПК, консоль, мобильное устройство или другой сервис" },
  item_state: { label: "Статус объявления", hint: "Активно, продано или на модерации" },
  region: { label: "Регион", hint: "Игровой регион или сервер аккаунта" },
  country: { label: "Страна", hint: "Страна регистрации или локаль аккаунта" },
  warranty: { label: "Гарантия", hint: "Срок гарантии продавца на аккаунт" },
  guarantee: { label: "Гарантия", hint: "Срок гарантии продавца по объявлению" },
  account_links: { label: "Привязки аккаунта", hint: "Соцсети и сервисы, привязанные к аккаунту" },
  email_access: { label: "Доступ к почте", hint: "Есть ли доступ к привязанной почте" },
  email_type: { label: "Тип почты", hint: "Провайдер привязанной почты" },
  email_provider: { label: "Провайдер почты", hint: "Сервис привязанной почты" },
  email_verified: { label: "Почта подтверждена", hint: "Подтверждён ли адрес привязанной почты" },
  phone_linked: { label: "Привязка телефона", hint: "Привязан ли номер телефона" },
  cookie_login: { label: "Вход по cookie", hint: "Доступен ли вход через cookie" },
  sessions: { label: "Сессии", hint: "Число активных сессий входа" },
  account_last_activity: { label: "Отлёга аккаунта", hint: "Сколько дней прошло с последнего входа игрока" },
  last_activity: { label: "Последняя активность", hint: "Давность последнего входа" },
  inactivity_days: { label: "Отлёга, дней", hint: "Сколько дней аккаунт не использовался" },
  level: { label: "Уровень", hint: "Уровень аккаунта" },
  banned: { label: "Баны", hint: "Есть ли блокировки на аккаунте" },
  verified: { label: "Верификация", hint: "Подтверждён ли аккаунт" },
  registration_date: { label: "Дата регистрации", hint: "Когда создан аккаунт" },
  // ——— World of Tanks ———
  wot_top_premium_tanks: { label: "Топ-премы", hint: "Количество топовых премиум-танков" },
  wot_credits: { label: "Серебро (кредиты)", hint: "Игровая валюта — кредиты" },
  gold: { label: "Золото", hint: "Игровая премиум-валюта (голда)" },
  tanks: { label: "Танки", hint: "Список ценных танков на аккаунте" },
  top_count: { label: "Топы", hint: "Количество топовых танков" },
  premium_count: { label: "Премы", hint: "Количество премиум-танков" },
  tier: { label: "Уровень техники", hint: "Максимальный уровень техники" },
  battles: { label: "Бои", hint: "Общее число проведённых боёв" },
  emblem: { label: "Эмблемы", hint: "Особые эмблемы и нашивки" },
  // ——— Telegram ———
  spam_block: { label: "Спам-блок", hint: "Есть ли ограничение на рассылку" },
  telegram_premium: { label: "Премиум Телеграм", hint: "Активна ли премиум-подписка" },
  followers_count: { label: "Подписчики", hint: "Число подписчиков" },
  session_age: { label: "Возраст сессии", hint: "Как давно создана сессия входа" },
  // ——— TikTok ———
  following_count: { label: "Подписки", hint: "На сколько аккаунтов подписан" },
  video_count: { label: "Видео", hint: "Количество опубликованных видео" },
  coins: { label: "Монеты", hint: "Баланс внутриигровых/сервисных монет" },
  // ——— Steam ———
  steam_level: { label: "Уровень Стим", hint: "Слабый признак: обычно влияет на цену не больше нескольких процентов" },
  steam_games_count: { label: "Игры в Стим", hint: "Не используйте само по себе: количество игр почти не определяет цену" },
  hours_played: { label: "Часы в играх", hint: "Суммарно сыграно часов" },
  inventory_value: { label: "Стоимость инвентаря", hint: "Только ориентир: в Dota 2 и TF2 встречаются предметы с ошибочной стоимостью" },
  // ——— Minecraft ———
  hypixel_level: { label: "Уровень Хайпиксель", hint: "Сетевой уровень на сервере Хайпиксель" },
  capes_count: { label: "Плащи", hint: "Количество плащей" },
  has_bans: { label: "Баны", hint: "Есть ли блокировки" },
  // ——— Genshin Impact / miHoYo ———
  adventure_rank: { label: "Ранг приключений", hint: "Ранг развития аккаунта" },
  primogems: { label: "Примогемы", hint: "Баланс примогемов" },
  welkin_active: { label: "Благословение полой луны", hint: "Активна ли ежемесячная подписка" },
  characters: { label: "Персонажи", hint: "Ценные персонажи на аккаунте" }
};

function normalizeKey(key) {
  return String(key ?? "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function glossaryEntry(field) {
  return FIELD_GLOSSARY[normalizeKey(field)] ?? null;
}

export function glossaryLabel(field) {
  return glossaryEntry(field)?.label ?? null;
}
