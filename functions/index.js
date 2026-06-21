import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

initializeApp();

const db = getFirestore();
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const MODEL = 'gemini-2.5-flash';
const DAILY_LIMIT = 30;
const REGION = 'us-central1';

const recipeResponseSchema = {
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
};

const stepsResponseSchema = {
  type: Type.ARRAY,
  items: { type: Type.STRING }
};

const getRequesterId = request => request.auth?.uid || `anon_${request.rawRequest.ip || 'unknown'}`;

const getDateKey = () => new Date().toISOString().slice(0, 10);

const readString = value => (typeof value === 'string' ? value.trim() : '');

const stripJsonCodeFence = value => readString(value)
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```$/i, '')
  .trim();

const parseJsonResponse = (text, fallback) => {
  try {
    return JSON.parse(stripJsonCodeFence(text || JSON.stringify(fallback)));
  } catch (err) {
    throw new HttpsError('internal', 'AI returned invalid JSON.');
  }
};

const sanitizeScannedRecipe = value => {
  const source = value && typeof value === 'object' ? value : {};
  const ingredients = Array.isArray(source.ingredients) ? source.ingredients : [];
  const method = Array.isArray(source.method) ? source.method : [];

  return {
    title: readString(source.title),
    description: readString(source.description),
    yield: readString(source.yield),
    servings: readString(source.servings),
    prepTime: readString(source.prepTime),
    cookTime: readString(source.cookTime),
    ingredients: ingredients
      .map(item => {
        const ingredient = item && typeof item === 'object' ? item : {};
        return {
          name: readString(ingredient.name),
          quantity: readString(ingredient.quantity),
          unit: readString(ingredient.unit)
        };
      })
      .filter(item => item.name || item.quantity || item.unit),
    method: method.map(step => readString(step)).filter(Boolean),
    notes: readString(source.notes)
  };
};

const sanitizeSteps = value => {
  const steps = Array.isArray(value) ? value : value?.steps;
  if (!Array.isArray(steps)) {
    throw new HttpsError('internal', 'AI response did not contain method steps.');
  }

  return steps.map(step => readString(step)).filter(Boolean);
};

const enforceDailyLimit = async ({ requesterId, action }) => {
  const dateKey = getDateKey();
  const usageRef = db.collection('aiUsage').doc(`${dateKey}_${requesterId}_${action}`);

  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(usageRef);
    const count = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

    if (count >= DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Daily AI request limit reached. Please try again tomorrow.');
    }

    transaction.set(usageRef, {
      requesterId,
      action,
      dateKey,
      count: count + 1,
      limit: DAILY_LIMIT,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: snapshot.exists ? snapshot.data().createdAt : FieldValue.serverTimestamp()
    }, { merge: true });
  });
};

const logRequest = async ({ requesterId, action, status, attempts, errorCode }) => {
  await db.collection('aiRequestLogs').add({
    requesterId,
    action,
    status,
    attempts,
    errorCode: errorCode || '',
    model: MODEL,
    createdAt: FieldValue.serverTimestamp()
  });
};

const shouldRetry = err => {
  const message = String(err?.message || '').toLowerCase();
  return message.includes('503') || message.includes('500') || message.includes('timeout') || message.includes('unavailable');
};

const callGeminiWithRetry = async generate => {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await generate();
      return { response, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt === 2 || !shouldRetry(err)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw lastError;
};

const getAi = () => new GoogleGenAI({ apiKey: geminiApiKey.value() });

export const scanRecipeImage = onCall({
  region: REGION,
  secrets: [geminiApiKey],
  timeoutSeconds: 120,
  memory: '512MiB'
}, async request => {
  const requesterId = getRequesterId(request);
  const action = 'scanRecipeImage';
  let attempts = 0;

  try {
    await enforceDailyLimit({ requesterId, action });

    const imageBase64 = readString(request.data?.imageBase64);
    const mimeType = readString(request.data?.mimeType) || 'image/jpeg';

    if (!imageBase64 || imageBase64.length > 8_000_000) {
      throw new HttpsError('invalid-argument', 'A valid compressed recipe image is required.');
    }

    if (!mimeType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'Only image uploads are supported.');
    }

    logger.info('AI recipe scan requested', { requesterId, action, mimeType, imageBytesApprox: Math.round(imageBase64.length * 0.75) });
    const ai = getAi();
    const { response, attempts: usedAttempts } = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          inlineData: {
            mimeType,
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
        responseSchema: recipeResponseSchema
      }
    }));
    attempts = usedAttempts;

    const parsed = parseJsonResponse(response.text, {});
    const recipe = sanitizeScannedRecipe(parsed);
    await logRequest({ requesterId, action, status: 'success', attempts });
    return { recipe };
  } catch (err) {
    attempts = attempts || 1;
    const errorCode = err instanceof HttpsError ? err.code : 'internal';
    logger.error('AI recipe scan failed', { requesterId, action, attempts, errorCode, message: err?.message });
    await logRequest({ requesterId, action, status: 'failed', attempts, errorCode }).catch(() => undefined);

    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', 'AI recipe scan failed. Please try again.');
  }
});

export const generateRecipeSteps = onCall({
  region: REGION,
  secrets: [geminiApiKey],
  timeoutSeconds: 60,
  memory: '256MiB'
}, async request => {
  const requesterId = getRequesterId(request);
  const action = 'generateRecipeSteps';
  let attempts = 0;

  try {
    await enforceDailyLimit({ requesterId, action });

    const title = readString(request.data?.title);
    const category = readString(request.data?.category);
    const recipeYield = readString(request.data?.yield);
    const ingredients = Array.isArray(request.data?.ingredients) ? request.data.ingredients : [];

    if (!title || ingredients.length === 0) {
      throw new HttpsError('invalid-argument', 'Recipe title and ingredients are required.');
    }

    const ingredientLines = ingredients
      .map(item => {
        const ingredient = item && typeof item === 'object' ? item : {};
        return `- ${[readString(ingredient.qty), readString(ingredient.unit), readString(ingredient.name)].filter(Boolean).join(' ')}`;
      })
      .filter(line => line !== '-')
      .join('\n');

    const prompt = `
Draft cooking method steps only for this recipe.

Recipe title: ${title}
Category: ${category || 'Not specified'}
Yield: ${recipeYield || 'Not specified'}
Ingredients:
${ingredientLines}

Rules:
- Return only a JSON array of strings.
- Generate method steps only.
- Do not generate nutrition.
- Do not generate cost.
- Do not generate new recipe ideas.
- Keep steps practical, concise, and editable.
`;

    logger.info('AI method draft requested', { requesterId, action, ingredientCount: ingredients.length });
    const ai = getAi();
    const { response, attempts: usedAttempts } = await callGeminiWithRetry(() => ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: stepsResponseSchema
      }
    }));
    attempts = usedAttempts;

    const steps = sanitizeSteps(parseJsonResponse(response.text, []));
    await logRequest({ requesterId, action, status: 'success', attempts });
    return { steps };
  } catch (err) {
    attempts = attempts || 1;
    const errorCode = err instanceof HttpsError ? err.code : 'internal';
    logger.error('AI method draft failed', { requesterId, action, attempts, errorCode, message: err?.message });
    await logRequest({ requesterId, action, status: 'failed', attempts, errorCode }).catch(() => undefined);

    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', 'AI method draft failed. Please try again.');
  }
});
