/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Ingredient } from '../types';

export type ParsedIngredient = Ingredient & {
  confidence: 'high' | 'medium' | 'low';
  originalText: string;
};

const KNOWN_UNITS = [
  'kg',
  'g',
  'mg',
  'l',
  'L',
  'ml',
  'pcs',
  'pc',
  'piece',
  'pieces',
  'clove',
  'cloves',
  'egg',
  'eggs',
  'tsp',
  'teaspoon',
  'teaspoons',
  'tbsp',
  'tablespoon',
  'tablespoons',
  'cup',
  'cups',
  'pinch',
  'pinches'
];

const UNIT_PATTERN = KNOWN_UNITS
  .map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|');

const QUANTITY_PATTERN = String.raw`(?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|(?:\d+\s+)?[¼½¾⅓⅔⅛⅜⅝⅞]|(?:\d+\s+)?\d+\s*\/\s*\d+)`;

const cleanIngredientLine = (line: string) => {
  return line
    .replace(/\u00a0/g, ' ')
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeQuantity = (value: string) => {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .trim();
};

const normalizeUnit = (unit: string) => {
  const trimmed = unit.trim();
  if (trimmed.toLowerCase() === 'liter' || trimmed.toLowerCase() === 'litre') return 'L';
  if (trimmed === 'l') return 'L';
  return trimmed;
};

const splitNotes = (value: string) => {
  let text = value.trim();
  const notes: string[] = [];

  const parenthetical = text.match(/\(([^)]+)\)\s*$/);
  if (parenthetical) {
    notes.push(parenthetical[1].trim());
    text = text.slice(0, parenthetical.index).trim();
  }

  const commaIndex = text.indexOf(',');
  if (commaIndex > -1) {
    notes.push(text.slice(commaIndex + 1).trim());
    text = text.slice(0, commaIndex).trim();
  }

  const toTasteMatch = text.match(/\s+(to taste)$/i);
  if (toTasteMatch) {
    notes.push(toTasteMatch[1]);
    text = text.slice(0, toTasteMatch.index).trim();
  }

  return {
    name: text.trim(),
    notes: notes.filter(Boolean).join(', ')
  };
};

const makeIngredient = (
  originalText: string,
  index: number,
  fields: Pick<Ingredient, 'name' | 'qty' | 'unit'> & { notes?: string },
  confidence: ParsedIngredient['confidence']
): ParsedIngredient => ({
  id: `ing_import_${Date.now()}_${index}`,
  name: fields.name.trim(),
  qty: fields.qty.trim(),
  unit: fields.unit.trim(),
  notes: fields.notes?.trim() || '',
  confidence,
  originalText
});

const isUnitAsIngredient = (unit: string) => {
  return ['egg', 'eggs'].includes(unit.toLowerCase());
};

export const parseIngredientLine = (line: string, index = 0): ParsedIngredient => {
  const cleaned = cleanIngredientLine(line);

  if (!cleaned) {
    return makeIngredient(line, index, { name: '', qty: '', unit: '', notes: '' }, 'low');
  }

  const countableOnlyMatch = cleaned.match(new RegExp(String.raw`^(${QUANTITY_PATTERN})\s*(egg|eggs)\b$`, 'i'));
  if (countableOnlyMatch) {
    const rawName = countableOnlyMatch[2] || '';
    return makeIngredient(cleaned, index, {
      name: rawName,
      qty: normalizeQuantity(countableOnlyMatch[1] || ''),
      unit: 'pcs',
      notes: ''
    }, 'high');
  }

  const leadingMatch = cleaned.match(new RegExp(String.raw`^(${QUANTITY_PATTERN})\s*(${UNIT_PATTERN})?\b\s*(.+)$`, 'i'));
  if (leadingMatch) {
    const qty = normalizeQuantity(leadingMatch[1] || '');
    const rawUnit = normalizeUnit(leadingMatch[2] || '');
    const remainder = (leadingMatch[3] || '').trim();
    const split = splitNotes(remainder);

    if (qty && remainder) {
      const unit = isUnitAsIngredient(rawUnit) ? 'pcs' : rawUnit;
      const name = isUnitAsIngredient(rawUnit)
        ? [rawUnit, split.name].filter(Boolean).join(' ')
        : split.name;

      return makeIngredient(cleaned, index, {
        name: name || cleaned,
        qty,
        unit,
        notes: split.notes
      }, rawUnit ? 'high' : 'medium');
    }
  }

  const trailingMatch = cleaned.match(new RegExp(String.raw`^(.+?)\s*(?:[-–—]\s*)?(${QUANTITY_PATTERN})\s*(${UNIT_PATTERN})?$`, 'i'));
  if (trailingMatch) {
    const split = splitNotes(trailingMatch[1] || '');
    const qty = normalizeQuantity(trailingMatch[2] || '');
    const unit = normalizeUnit(trailingMatch[3] || '');

    if (split.name && qty) {
      return makeIngredient(cleaned, index, {
        name: split.name,
        qty,
        unit,
        notes: split.notes
      }, unit ? 'high' : 'medium');
    }
  }

  const split = splitNotes(cleaned);
  if (split.notes && split.name) {
    return makeIngredient(cleaned, index, {
      name: split.name,
      qty: '',
      unit: '',
      notes: split.notes
    }, 'medium');
  }

  return makeIngredient(cleaned, index, { name: cleaned, qty: '', unit: '', notes: '' }, 'low');
};

export const parseIngredientLines = (lines: string[]) => {
  return lines
    .map((line, index) => parseIngredientLine(line, index))
    .filter(ingredient => ingredient.name.trim());
};
