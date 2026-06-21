/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export type GeminiScannedIngredient = {
  name: string;
  quantity: string;
  unit: string;
};

export type GeminiScannedRecipe = {
  title: string;
  description: string;
  yield: string;
  servings: string;
  prepTime: string;
  cookTime: string;
  ingredients: GeminiScannedIngredient[];
  method: string[];
  notes: string;
};

const readFileAsBase64 = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
};

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const getDataUrlMimeType = (dataUrl?: string) => {
  const match = dataUrl?.match(/^data:([^;,]+)[;,]/);
  return match?.[1] || '';
};

const normalizeScannedRecipe = (parsed: unknown): GeminiScannedRecipe => {
  const source = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const rawIngredients = Array.isArray(source.ingredients) ? source.ingredients : [];
  const rawMethod = Array.isArray(source.method) ? source.method : [];

  const scannedRecipe = {
    title: readString(source.title),
    description: readString(source.description),
    yield: readString(source.yield),
    servings: readString(source.servings),
    prepTime: readString(source.prepTime),
    cookTime: readString(source.cookTime),
    ingredients: rawIngredients
      .map(item => {
        if (!item || typeof item !== 'object') {
          return { name: '', quantity: '', unit: '' };
        }
        const ingredient = item as Record<string, unknown>;
        return {
          name: readString(ingredient.name),
          quantity: readString(ingredient.quantity),
          unit: readString(ingredient.unit)
        };
      })
      .filter(ingredient => ingredient.name || ingredient.quantity || ingredient.unit),
    method: rawMethod.map(step => readString(step)).filter(Boolean),
    notes: readString(source.notes)
  };

  return scannedRecipe;
};

export const generateRecipeStepsWithAI = async ({
  title,
  category,
  yield: recipeYield,
  ingredients
}: {
  title: string;
  category: string;
  yield: string;
  ingredients: Array<{ name: string; qty: string; unit: string }>;
}) => {
  if (!functions) {
    throw new Error('AI backend is unavailable. Please check Firebase configuration.');
  }

  const generateSteps = httpsCallable<
    {
      title: string;
      category: string;
      yield: string;
      ingredients: Array<{ name: string; qty: string; unit: string }>;
    },
    { steps: string[] }
  >(functions, 'generateRecipeSteps');

  const response = await generateSteps({
    title,
    category,
    yield: recipeYield,
    ingredients
  });

  return Array.isArray(response.data.steps)
    ? response.data.steps.map(step => readString(step)).filter(Boolean)
    : [];
};

export const scanRecipeImageWithGemini = async ({
  file,
  imageDataUrl,
  onStage
}: {
  file: File;
  imageDataUrl?: string;
  onStage?: (stage: 'reading' | 'extracting') => void;
}) => {
  if (!functions) {
    throw new Error('AI backend is unavailable. Please check Firebase configuration.');
  }

  const imageBase64 = imageDataUrl?.split(',')[1] || await readFileAsBase64(file);
  const mimeType = getDataUrlMimeType(imageDataUrl) || file.type || 'image/jpeg';
  onStage?.('reading');

  const scanImage = httpsCallable<
    { imageBase64: string; mimeType: string },
    { recipe: GeminiScannedRecipe }
  >(functions, 'scanRecipeImage');

  const response = await scanImage({
    imageBase64,
    mimeType
  });

  onStage?.('extracting');
  return normalizeScannedRecipe(response.data.recipe);
};
