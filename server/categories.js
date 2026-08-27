const RARITIES = [
  { id: 'common', label: 'Обычная', weight: 50 },
  { id: 'uncommon', label: 'Необычная', weight: 25 },
  { id: 'rare', label: 'Редкая', weight: 15 },
  { id: 'epic', label: 'Эпическая', weight: 7 },
  { id: 'legendary', label: 'Легендарная', weight: 3 }
];

const RARITY_MAP = Object.fromEntries(RARITIES.map((r) => [r.id, r]));

function parseCards(cardsText) {
  return String(cardsText || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rarityWeight(rarityId) {
  return RARITY_MAP[rarityId]?.weight ?? RARITY_MAP.common.weight;
}

function rarityLabel(rarityId) {
  return RARITY_MAP[rarityId]?.label || 'Обычная';
}

function normalizeRarity(rarityId) {
  return RARITY_MAP[rarityId] ? rarityId : 'common';
}

function createDefaultCategory(id = 'cat_default') {
  return {
    id,
    name: 'Стандартная категория',
    rarity: 'common',
    cardsText: 'Отжимания x20, Песня в войс-чат, История из жизни, Стример выбирает сам',
    enabled: true,
    spoiler: ''
  };
}

function normalizeCategory(raw, fallbackId) {
  const cardsText =
    raw.cardsText != null
      ? String(raw.cardsText)
      : Array.isArray(raw.cards)
        ? raw.cards.map((c) => String(c || '').trim()).filter(Boolean).join(', ')
        : '';
  return {
    id: String(raw.id || fallbackId || `cat_${Date.now().toString(36)}`),
    name: String(raw.name || 'Категория').trim() || 'Категория',
    rarity: normalizeRarity(raw.rarity),
    cardsText,
    enabled: raw.enabled !== false,
    spoiler: String(raw.spoiler || '').trim()
  };
}

/** Старые tasks[] → одна категория */
function migrateTasksToCategories(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length) return [createDefaultCategory()];
  return [
    {
      id: 'cat_default',
      name: 'Стандартная категория',
      rarity: 'common',
      cardsText: list
        .map((t) => String(t?.text || '').trim())
        .filter(Boolean)
        .join(', '),
      enabled: true,
      spoiler: String(list.find((t) => t?.spoiler)?.spoiler || '').trim()
    }
  ];
}

function ensureCategories(stateLike) {
  if (Array.isArray(stateLike.categories) && stateLike.categories.length) {
    return stateLike.categories.map((c, i) => normalizeCategory(c, `cat_${i}`));
  }
  return migrateTasksToCategories(stateLike.tasks);
}

/**
 * Разворачивает категории в плоский список заданий для оверлея / снимка.
 * Вес категории делится между карточками, чтобы число карточек не ломало шансы.
 */
function expandCategoriesToTasks(categories) {
  const out = [];
  for (const cat of categories || []) {
    if (!cat || cat.enabled === false) continue;
    const cards = parseCards(cat.cardsText);
    if (!cards.length) continue;
    const catWeight = rarityWeight(cat.rarity);
    const perCard = catWeight / cards.length;
    cards.forEach((text, i) => {
      out.push({
        id: `${cat.id}_${i}`,
        text,
        weight: perCard,
        spoiler: cat.spoiler || '',
        rarity: cat.rarity,
        categoryId: cat.id,
        categoryName: cat.name
      });
    });
  }
  return out;
}

/** Сначала категория по редкости, затем случайная карточка внутри */
function pickFromCategories(categories) {
  const active = (categories || []).filter(
    (c) => c && c.enabled !== false && parseCards(c.cardsText).length > 0
  );
  if (!active.length) return null;

  const total = active.reduce((s, c) => s + rarityWeight(c.rarity), 0);
  let r = Math.random() * total;
  let chosen = active[active.length - 1];
  for (const cat of active) {
    r -= rarityWeight(cat.rarity);
    if (r <= 0) {
      chosen = cat;
      break;
    }
  }

  const cards = parseCards(chosen.cardsText);
  const index = Math.floor(Math.random() * cards.length);
  const text = cards[index];
  return {
    id: `${chosen.id}_${index}`,
    text,
    weight: rarityWeight(chosen.rarity),
    spoiler: chosen.spoiler || '',
    rarity: chosen.rarity,
    categoryId: chosen.id,
    categoryName: chosen.name
  };
}

/** Шанс категории среди включённых (для UI) */
function categoryDropChancePercent(categories, categoryId) {
  const active = (categories || []).filter(
    (c) => c && c.enabled !== false && parseCards(c.cardsText).length > 0
  );
  const total = active.reduce((s, c) => s + rarityWeight(c.rarity), 0);
  if (total <= 0) return 0;
  const cat = active.find((c) => c.id === categoryId);
  if (!cat) {
    const raw = (categories || []).find((c) => c.id === categoryId);
    if (!raw || raw.enabled === false) return 0;
    return Math.round((rarityWeight(raw.rarity) / (total + rarityWeight(raw.rarity))) * 1000) / 10;
  }
  return Math.round((rarityWeight(cat.rarity) / total) * 1000) / 10;
}

module.exports = {
  RARITIES,
  RARITY_MAP,
  parseCards,
  rarityWeight,
  rarityLabel,
  normalizeRarity,
  createDefaultCategory,
  normalizeCategory,
  migrateTasksToCategories,
  ensureCategories,
  expandCategoriesToTasks,
  pickFromCategories,
  categoryDropChancePercent
};
