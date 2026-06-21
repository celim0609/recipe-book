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
  'pinches',
  '包',
  '罐',
  '瓶',
  '盒',
  '袋',
  '粒',
  '个',
  '钱',
  '兩',
  '两',
  '斤'
];

const UNIT_PATTERN = KNOWN_UNITS
  .map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|');

const QUANTITY_PATTERN = String.raw`(?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|(?:\d+\s+)?[¼½¾⅓⅔⅛⅜⅝⅞]|(?:\d+\s+)?\d+\s*\/\s*\d+|半)`;
const QUALITATIVE_UNITS = ['to taste', 'as needed', '适量', '少许'];
const QUALITATIVE_PATTERN = String.raw`(?:to taste|as needed|适量|少许)`;
const TRADITIONAL_CHINESE_UNIT_GRAMS: Record<string, number> = {
  '钱': 3.75,
  '兩': 37.5,
  '两': 37.5,
  '斤': 600
};
const CHINESE_INGREDIENT_NAMES: Record<string, { en: string; zh: string }> = {
  '水': { en: 'Water', zh: '水' },
  '白凉粉': { en: 'White Jelly Powder', zh: '白凉粉' },
  '白涼粉': { en: 'White Jelly Powder', zh: '白涼粉' },
  '柚子肉': { en: 'Pomelo Pulp', zh: '柚子肉' },
  '芒果汁': { en: 'Mango Juice', zh: '芒果汁' },
  '芒果粒': { en: 'Mango Cubes', zh: '芒果粒' },
  '芋头': { en: 'Taro', zh: '芋头' },
  '芋頭': { en: 'Taro', zh: '芋頭' },
  '盐': { en: 'Salt', zh: '盐' },
  '鹽': { en: 'Salt', zh: '鹽' },
  '糖': { en: 'Sugar', zh: '糖' },
  '鸡粉': { en: 'Chicken powder', zh: '鸡粉' },
  '雞粉': { en: 'Chicken powder', zh: '雞粉' },
  '薯粉': { en: 'Tapioca starch', zh: '薯粉' },
  '粟粉': { en: 'Corn starch', zh: '粟粉' }
};

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

const parseQuantityNumber = (value: string) => {
  const normalized = normalizeQuantity(value).replace(',', '.');
  const unicodeFractions: Record<string, number> = {
    '¼': 0.25,
    '½': 0.5,
    '¾': 0.75,
    '⅓': 1 / 3,
    '⅔': 2 / 3,
    '⅛': 0.125,
    '⅜': 0.375,
    '⅝': 0.625,
    '⅞': 0.875,
    '半': 0.5
  };

  if (unicodeFractions[normalized] !== undefined) return unicodeFractions[normalized];

  const mixedUnicode = normalized.match(/^(\d+)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (mixedUnicode) {
    return Number(mixedUnicode[1]) + unicodeFractions[mixedUnicode[2]];
  }

  const fraction = normalized.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator ? numerator / denominator : null;
  }

  const mixedFraction = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    return denominator ? whole + numerator / denominator : null;
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const formatQuantity = (value: number) => {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2))).replace(/\.0+$/, '');
};

const normalizeUnit = (unit: string) => {
  const trimmed = unit.trim();
  if (trimmed.toLowerCase() === 'liter' || trimmed.toLowerCase() === 'litre') return 'L';
  if (trimmed === 'l') return 'L';
  return trimmed;
};

const normalizeIngredientName = (value: string) => {
  const trimmed = value
    .replace(/\s*\(([^)]+)\)\s*$/, (_match, alias) => ` ${alias}`)
    .replace(/\s+/g, ' ')
    .trim();
  const pipePrimaryName = trimmed
    .split('|')
    .map(part => part.trim())
    .filter(Boolean)[0] || trimmed;

  const translatedName = CHINESE_INGREDIENT_NAMES[pipePrimaryName];
  return translatedName ? `${translatedName.en} (${translatedName.zh})` : pipePrimaryName;
};

const normalizeParsedQuantityUnit = (qty: string, unit: string) => {
  const normalizedUnit = normalizeUnit(unit);
  const conversion = TRADITIONAL_CHINESE_UNIT_GRAMS[normalizedUnit];

  if (!conversion) {
    return {
      qty: normalizeQuantity(qty),
      unit: normalizedUnit
    };
  }

  const amount = parseQuantityNumber(qty);
  if (amount === null) {
    return {
      qty: normalizeQuantity(qty),
      unit: normalizedUnit
    };
  }

  return {
    qty: formatQuantity(amount * conversion),
    unit: 'g'
  };
};

const parseChineseMixedQuantity = (value: string, unit: string) => {
  const conversion = TRADITIONAL_CHINESE_UNIT_GRAMS[unit];
  if (!conversion) return null;

  const normalized = value.replace(/\s+/g, '');
  const mixedMatch = normalized.match(/^(\d+(?:[.,]\d+)?)半$/);
  if (mixedMatch) {
    return (Number(mixedMatch[1].replace(',', '.')) + 0.5) * conversion;
  }

  if (normalized === '半') {
    return 0.5 * conversion;
  }

  const amount = parseQuantityNumber(normalized);
  return amount === null ? null : amount * conversion;
};

const parseChineseUnitIngredient = (cleaned: string, index: number) => {
  const chineseUnits = `[${Object.keys(TRADITIONAL_CHINESE_UNIT_GRAMS).join('')}]`;
  const compact = cleaned.replace(/\s+/g, '');
  const leadingMatch = compact.match(new RegExp(String.raw`^(\d+(?:[.,]\d+)?|半)(${chineseUnits})(半?)(.+)$`));
  const trailingMatch = compact.match(new RegExp(String.raw`^(.+?)(\d+(?:[.,]\d+)?|半)(${chineseUnits})(半?)$`));
  const match = leadingMatch
    ? { name: leadingMatch[4], quantity: `${leadingMatch[1]}${leadingMatch[3]}`, unit: leadingMatch[2] }
    : trailingMatch
      ? { name: trailingMatch[1], quantity: `${trailingMatch[2]}${trailingMatch[4]}`, unit: trailingMatch[3] }
      : null;

  if (!match?.name) return null;

  const grams = parseChineseMixedQuantity(match.quantity, match.unit);
  if (grams === null) return null;

  return makeIngredient(cleaned, index, {
    name: normalizeIngredientName(match.name),
    qty: formatQuantity(grams),
    unit: 'g',
    notes: ''
  }, 'high');
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
    name: normalizeIngredientName(text),
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

  const chineseUnitIngredient = parseChineseUnitIngredient(cleaned, index);
  if (chineseUnitIngredient) {
    return chineseUnitIngredient;
  }

  const pipeParts = cleaned.split('|').map(part => part.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    const quantityIndex = pipeParts.findIndex(part =>
      new RegExp(String.raw`^${QUANTITY_PATTERN}\s*(${UNIT_PATTERN})?$`, 'i').test(part) ||
      new RegExp(String.raw`^${QUALITATIVE_PATTERN}$`, 'i').test(part)
    );
    const namePart = pipeParts.find((_part, partIndex) => partIndex !== quantityIndex) || pipeParts[0];
    const quantityPart = quantityIndex >= 0 ? pipeParts[quantityIndex] : '';

    if (quantityPart && namePart) {
      const qualitative = quantityPart.match(new RegExp(String.raw`^(${QUALITATIVE_PATTERN})$`, 'i'));
      const quantityUnit = quantityPart.match(new RegExp(String.raw`^(${QUANTITY_PATTERN})\s*(${UNIT_PATTERN})?$`, 'i'));

      if (qualitative) {
        return makeIngredient(cleaned, index, {
          name: normalizeIngredientName(namePart),
          qty: '',
          unit: qualitative[1],
          notes: pipeParts.filter(part => part !== namePart && part !== quantityPart).join(', ')
        }, 'high');
      }

      if (quantityUnit) {
        const parsed = normalizeParsedQuantityUnit(quantityUnit[1] || '', quantityUnit[2] || '');
        return makeIngredient(cleaned, index, {
          name: normalizeIngredientName(namePart),
          qty: parsed.qty,
          unit: parsed.unit,
          notes: pipeParts.filter(part => part !== namePart && part !== quantityPart).join(', ')
        }, parsed.unit ? 'high' : 'medium');
      }
    }
  }

  const qualitativeMatch = cleaned.match(new RegExp(String.raw`^(.+?)(?:\s*[:：–—-]\s*|\s+)(${QUALITATIVE_PATTERN})$`, 'i'));
  if (qualitativeMatch) {
    const split = splitNotes(qualitativeMatch[1] || '');
    return makeIngredient(cleaned, index, {
      name: split.name,
      qty: '',
      unit: qualitativeMatch[2] || '',
      notes: split.notes
    }, 'high');
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

  const leadingMatch = cleaned.match(new RegExp(String.raw`^(${QUANTITY_PATTERN})\s*(${UNIT_PATTERN})?\s*(.+)$`, 'i'));
  if (leadingMatch) {
    const rawUnit = normalizeUnit(leadingMatch[2] || '');
    const parsed = normalizeParsedQuantityUnit(leadingMatch[1] || '', rawUnit);
    const remainder = (leadingMatch[3] || '').trim();
    const split = splitNotes(remainder);

    if (parsed.qty && remainder) {
      const unit = isUnitAsIngredient(rawUnit) ? 'pcs' : rawUnit;
      const name = isUnitAsIngredient(rawUnit)
        ? [rawUnit, split.name].filter(Boolean).join(' ')
        : split.name;

      return makeIngredient(cleaned, index, {
        name: name || cleaned,
        qty: isUnitAsIngredient(rawUnit) ? parsed.qty : parsed.qty,
        unit: isUnitAsIngredient(rawUnit) ? 'pcs' : parsed.unit,
        notes: split.notes
      }, rawUnit ? 'high' : 'medium');
    }
  }

  const trailingMatch = cleaned.match(new RegExp(String.raw`^(.+?)\s*(?:[:：|]|[-–—]\s*)?\s*(${QUANTITY_PATTERN})\s*(${UNIT_PATTERN})?$`, 'i'));
  if (trailingMatch) {
    const split = splitNotes(trailingMatch[1] || '');
    const parsed = normalizeParsedQuantityUnit(trailingMatch[2] || '', trailingMatch[3] || '');

    if (split.name && parsed.qty) {
      return makeIngredient(cleaned, index, {
        name: split.name,
        qty: parsed.qty,
        unit: parsed.unit,
        notes: split.notes
      }, parsed.unit ? 'high' : 'medium');
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
