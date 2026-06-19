/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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

export const getGeminiApiKey = () => {
  const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) || {};
  return viteEnv.VITE_GEMINI_API_KEY || viteEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
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

const stripJsonCodeFence = (value: string) => {
  return value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
};

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const parseGeminiRecipeJson = (text: string): GeminiScannedRecipe => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripJsonCodeFence(text || '{}'));
  } catch {
    throw new Error('Gemini returned invalid JSON. Please try a clearer image.');
  }

  const source = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const rawIngredients = Array.isArray(source.ingredients) ? source.ingredients : [];
  const rawMethod = Array.isArray(source.method) ? source.method : [];

  return {
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
};

export const scanRecipeImageWithGemini = async ({
  file,
  imageDataUrl
}: {
  file: File;
  imageDataUrl?: string;
}) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Scan Recipe needs a Gemini API key. Add VITE_GEMINI_API_KEY to your local environment.');
  }

  const { GoogleGenAI, Type } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const imageBase64 = imageDataUrl?.split(',')[1] || await readFileAsBase64(file);
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBase64
        }
      },
      {
        text: [
          'Extract one recipe from this image.',
          'Return ONLY valid JSON with this exact shape:',
          '{"title":"","description":"","yield":"","servings":"","prepTime":"","cookTime":"","ingredients":[{"name":"","quantity":"","unit":""}],"method":[],"notes":""}',
          'Use only text visibly present in the image.',
          'If a field cannot be recognized, leave it blank.',
          'Do not guess, infer, add nutrition, add cost, or invent missing recipe details.'
        ].join(' ')
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          yield: { type: Type.STRING },
          servings: { type: Type.STRING },
          prepTime: { type: Type.STRING },
          cookTime: { type: Type.STRING },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                quantity: { type: Type.STRING },
                unit: { type: Type.STRING }
              }
            }
          },
          method: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          notes: { type: Type.STRING }
        }
      }
    }
  });

  return parseGeminiRecipeJson(response.text || '{}');
};
