/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import ingredients from '../data/dictionary/ingredients.json';
import { KitchenDictionaryIngredient, UserRole } from '../types';
import { isAdminRole } from '../utils/userRoles';

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

export const canAccessKitchenDictionary = (role: UserRole) => isAdminRole(role);

export const getKitchenDictionaryIngredients = (role: UserRole): KitchenDictionaryIngredient[] => {
  if (!canAccessKitchenDictionary(role)) return [];
  return KITCHEN_DICTIONARY_INGREDIENTS.map(entry => ({
    ...entry,
    aliases: [...entry.aliases]
  }));
};

export const getKitchenDictionaryCategories = (role: UserRole): string[] => {
  if (!canAccessKitchenDictionary(role)) return [];

  return Array.from(new Set(
    KITCHEN_DICTIONARY_INGREDIENTS
      .map(entry => entry.category)
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
};
