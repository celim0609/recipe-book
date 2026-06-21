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

const getCallableErrorMessage = (err: unknown, fallbackMessage: string) => {
  const source = err && typeof err === 'object' ? err as Record<string, unknown> : {};
  const details = source.details && typeof source.details === 'object'
    ? source.details as Record<string, unknown>
    : {};
  const diagnostics = details.diagnostics && typeof details.diagnostics === 'object'
    ? details.diagnostics as Record<string, unknown>
    : {};
  const devMessage = [
    typeof source.message === 'string' ? source.message : '',
    typeof details.reason === 'string' ? `Reason: ${details.reason}` : '',
    typeof diagnostics.message === 'string' ? `Backend: ${diagnostics.message}` : '',
    typeof source.code === 'string' ? `Code: ${source.code}` : ''
  ].filter(Boolean).join(' | ');

  return import.meta.env.DEV && devMessage ? devMessage : fallbackMessage;
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

const parseScannedRecipeResponse = (value: unknown) => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (!source.recipe || typeof source.recipe !== 'object') {
    throw new Error('AI scan returned an unexpected response shape.');
  }

  return normalizeScannedRecipe(source.recipe);
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
      debug?: boolean;
    },
    { steps: string[] }
  >(functions, 'generateRecipeSteps');

  const response = await generateSteps({
    title,
    category,
    yield: recipeYield,
    ingredients,
    debug: import.meta.env.DEV
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
  console.info('[AI Scan] Invoking callable scanRecipeImage', {
    mimeType,
    imageBytesApprox: Math.round(imageBase64.length * 0.75),
    region: 'us-central1'
  });

  const scanImage = httpsCallable<
    { imageBase64: string; mimeType: string; debug?: boolean },
    { recipe: GeminiScannedRecipe }
  >(functions, 'scanRecipeImage');

  try {
    const response = await scanImage({
      imageBase64,
      mimeType,
      debug: import.meta.env.DEV
    });

    console.info('[AI Scan] Callable response received', {
      hasData: Boolean(response.data),
      hasRecipe: Boolean(response.data?.recipe)
    });
    onStage?.('extracting');
    const recipe = parseScannedRecipeResponse(response.data);
    console.info('[AI Scan] Callable response parsed', {
      titlePresent: Boolean(recipe.title),
      ingredientCount: recipe.ingredients.length,
      methodStepCount: recipe.method.length
    });
    return recipe;
  } catch (err) {
    console.error('[AI Scan] Callable failed', err);
    throw new Error(getCallableErrorMessage(err, 'AI recipe scan failed. Please try again.'));
  }
};
