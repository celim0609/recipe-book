/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ingredients from '../data/dictionary/ingredients.json';
import { KitchenDictionaryIngredient, UserRole } from '../types';
import { isAdminRole } from '../utils/userRoles';

const CUSTOM_DICTIONARY_STORAGE_KEY = 'misechef_kitchen_dictionary_custom_entries_v1';

const normalizeDictionaryEntry = (entry: KitchenDictionaryIngredient): KitchenDictionaryIngredient => ({
  chinese: entry.chinese.trim(),
  english: entry.english.trim(),
  category: entry.category.trim(),
  aliases: Array.isArray(entry.aliases)
    ? entry.aliases.map(alias => alias.trim()).filter(Boolean)
    : []
});

const KITCHEN_DICTIONARY_INGREDIENTS = (ingredients as KitchenDictionaryIngredient[])
  .map(normalizeDictionaryEntry)
  .filter(entry => entry.chinese && entry.english);

let customKitchenDictionaryIngredients: KitchenDictionaryIngredient[] = [];

const loadCustomKitchenDictionaryIngredients = () => {
  if (typeof window === 'undefined') return [];

  try {
    const cached = window.localStorage.getItem(CUSTOM_DICTIONARY_STORAGE_KEY);
    if (!cached) return [];

    const parsed = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(entry => normalizeDictionaryEntry(entry as KitchenDictionaryIngredient))
      .filter(entry => entry.chinese && entry.english);
  } catch (err) {
    return [];
  }
};

const saveCustomKitchenDictionaryIngredients = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CUSTOM_DICTIONARY_STORAGE_KEY, JSON.stringify(customKitchenDictionaryIngredients));
};

customKitchenDictionaryIngredients = loadCustomKitchenDictionaryIngredients();

const getAllKitchenDictionaryIngredients = () => [
  ...KITCHEN_DICTIONARY_INGREDIENTS,
  ...customKitchenDictionaryIngredients
];

const normalizeDictionaryKey = (value: string) => value.trim().toLowerCase();

const buildKitchenDictionaryLookup = () => getAllKitchenDictionaryIngredients().reduce<Record<string, KitchenDictionaryIngredient>>((acc, entry) => {
  [
    entry.chinese,
    entry.english,
    `${entry.english} (${entry.chinese})`,
    ...entry.aliases
  ].forEach(value => {
    const key = normalizeDictionaryKey(value);
    if (key) acc[key] = entry;
  });

  return acc;
}, {});

const getKitchenDictionaryLookupCandidates = (name: string) => {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  const candidates = new Set<string>([trimmed]);
  const bilingualMatch = trimmed.match(/^(.+?)\s*\((.+)\)$/);

  if (bilingualMatch) {
    candidates.add(bilingualMatch[1].trim());
    candidates.add(bilingualMatch[2].trim());
  }

  trimmed
    .split('|')
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => candidates.add(part));

  return Array.from(candidates);
};

export const findKitchenDictionaryIngredientByName = (name: string) => {
  const dictionaryLookup = buildKitchenDictionaryLookup();

  for (const candidate of getKitchenDictionaryLookupCandidates(name)) {
    const entry = dictionaryLookup[normalizeDictionaryKey(candidate)];
    if (entry) return entry;
  }

  return null;
};

export const normalizeKitchenDictionaryIngredientName = (name: string) => {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return {
      name: '',
      englishName: '',
      chineseName: ''
    };
  }

  const entry = findKitchenDictionaryIngredientByName(trimmed);
  if (!entry) {
    return {
      name: trimmed,
      englishName: trimmed,
      chineseName: trimmed
    };
  }

  return {
    name: `${entry.english} (${entry.chinese})`,
    englishName: entry.english,
    chineseName: entry.chinese
  };
};

export const canReadKitchenDictionary = () => true;

export const canCreateKitchenDictionaryEntry = (role: UserRole) => isAdminRole(role);

export const canUpdateKitchenDictionaryEntry = (role: UserRole) => isAdminRole(role);

export const canDeleteKitchenDictionaryEntry = (role: UserRole) => isAdminRole(role);

export const isKnownKitchenDictionaryIngredientName = (name: string) => {
  return Boolean(findKitchenDictionaryIngredientByName(name));
};

export const createKitchenDictionaryEntry = (
  role: UserRole,
  entry: KitchenDictionaryIngredient
) => {
  if (!canCreateKitchenDictionaryEntry(role)) {
    throw new Error('Only admin users can add Kitchen Dictionary entries.');
  }

  const normalizedEntry = normalizeDictionaryEntry(entry);
  if (!normalizedEntry.chinese || !normalizedEntry.english) {
    throw new Error('Ingredient name is required.');
  }

  const existingEntry = findKitchenDictionaryIngredientByName(normalizedEntry.english)
    || findKitchenDictionaryIngredientByName(normalizedEntry.chinese)
    || normalizedEntry.aliases.map(findKitchenDictionaryIngredientByName).find(Boolean);

  if (existingEntry) return existingEntry;

  customKitchenDictionaryIngredients = [
    ...customKitchenDictionaryIngredients,
    normalizedEntry
  ];
  saveCustomKitchenDictionaryIngredients();

  return normalizedEntry;
};

export const getKitchenDictionaryIngredients = (): KitchenDictionaryIngredient[] => {
  if (!canReadKitchenDictionary()) return [];
  return getAllKitchenDictionaryIngredients().map(entry => ({
    ...entry,
    aliases: [...entry.aliases]
  }));
};

export const getKitchenDictionaryCategories = (): string[] => {
  if (!canReadKitchenDictionary()) return [];

  return Array.from(new Set(
    getAllKitchenDictionaryIngredients()
      .map(entry => entry.category)
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
};
