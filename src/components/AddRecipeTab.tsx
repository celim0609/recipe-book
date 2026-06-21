/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Camera, FileText, Image as ImageIcon, MoreHorizontal, Plus, Trash2, X, Sparkles, Video } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist/webpack.mjs';
import { Recipe, Ingredient, MethodStep, RecipeCategory, UserRole } from '../types';
import { generateRecipeStepsWithAI, scanRecipeImageWithGemini } from '../services/gemini';
import { normalizeIngredientForDisplay, parseIngredientLines } from '../utils/ingredientParser';
import { FALLBACK_CATEGORY_NAME, getRecipeCategories, normalizeRecipeCategories } from '../utils/categoryUtils';
import { canAccessKitchenDictionary, isKnownKitchenDictionaryIngredientName } from '../services/kitchenDictionary';

const MAX_COVER_IMAGE_SIDE = 1200;
const MAX_COVER_IMAGE_BYTES = 500 * 1024;
const INITIAL_JPEG_QUALITY = 0.75;
const MAX_SCAN_IMAGE_SIDE = 1600;
const SCAN_JPEG_QUALITY = 0.8;

type AiImportStage = 'uploading' | 'reading' | 'extracting' | 'building' | 'ready';

const AI_IMPORT_STAGES: Record<AiImportStage, { title: string; description: string }> = {
  uploading: {
    title: '📷 Uploading image...',
    description: 'Preparing your photo for AI analysis.'
  },
  reading: {
    title: '🤖 AI is reading your recipe...',
    description: 'Recognizing text and recipe structure.'
  },
  extracting: {
    title: '📝 Extracting recipe details...',
    description: 'Finding title, ingredients, quantities, methods, servings and notes.'
  },
  building: {
    title: '🍳 Building your recipe...',
    description: 'Populating the Recipe Editor.'
  },
  ready: {
    title: '✅ Recipe ready!',
    description: 'Please review before importing.'
  }
};

type ParsedImportedRecipe = {
  id: string;
  title: string;
  description: string;
  yield: string;
  servings: number | null;
  prepTime: number | null;
  cookTime: number | null;
  chefNotes: string;
  scannedImageDataUrl?: string;
  ingredients: Ingredient[];
  method: MethodStep[];
  sourceText: string;
};

const cleanImportedLine = (line: string) => {
  return line
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim();
};

const isSectionHeading = (line: string, keywords: string[]) => {
  const normalized = line.toLowerCase().replace(/[:：]/g, '').trim();
  return keywords.some(keyword => normalized === keyword);
};

const isAnyRecipeSectionHeading = (line: string) => {
  return isSectionHeading(line, [
    'ingredients',
    'ingredient',
    'ingredient list',
    'method',
    'steps',
    'instructions',
    'directions',
    'procedure',
    'preparation',
    'chef notes',
    'notes'
  ]);
};

const cleanMarkdownHeading = (line: string) => {
  return line.replace(/^#{1,6}\s+/, '').trim();
};

const parseTimeToMinutes = (value: string) => {
  const normalized = value.toLowerCase().replace(/mins?\b/g, 'minutes').replace(/hrs?\b/g, 'hours');
  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:hours?|h)\b/);
  const minuteMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|m)\b/);
  const bareNumberMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const bareMinutes = !hourMatch && !minuteMatch && bareNumberMatch ? Number(bareNumberMatch[1]) : 0;
  const total = hours + minutes + bareMinutes;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
};

const parseServingsValue = (value: string) => {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

const parsePastedRecipe = (rawText: string) => {
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  let parsedTitle = '';
  let parsedYield = '';
  let parsedServings: number | null = null;
  let parsedPrepTime: number | null = null;
  let parsedCookTime: number | null = null;
  let parsedChefNotes = '';
  const ingredientLines: string[] = [];
  const methodLines: string[] = [];
  const candidateIngredientLines: string[] = [];
  let activeSection: 'ingredients' | 'method' | null = null;

  lines.forEach((line, index) => {
    const cleanedLine = cleanImportedLine(cleanMarkdownHeading(line));
    const parsedLineIngredient = parseIngredientLines([line])[0];
    const lineLooksLikeIngredient = Boolean(
      parsedLineIngredient &&
      parsedLineIngredient.confidence !== 'low' &&
      (parsedLineIngredient.qty || parsedLineIngredient.unit)
    );
    const titleMatch = line.match(/^(recipe\s*name|recipe\s*title|title|name)\s*[:：]\s*(.+)$/i);
    const yieldMatch = line.match(/^(yield|makes|serves|servings)\s*[:：]\s*(.+)$/i);
    const servingsMatch = line.match(/^(serves|servings)\s*[:：]?\s*(.+)$/i);
    const prepTimeMatch = line.match(/^(prep(?:aration)?\s*time|prep)\s*[:：]?\s*(.+)$/i);
    const cookTimeMatch = line.match(/^(cook(?:ing)?\s*time|cook|bake\s*time|baking\s*time)\s*[:：]?\s*(.+)$/i);
    const chefNotesMatch = line.match(/^(chef\s*notes?|notes?)\s*[:：]?\s*(.+)$/i);
    const ingredientsMatch = line.match(/^(ingredients?|ingredient list)\s*[:：]?\s*(.*)$/i);
    const methodMatch = line.match(/^(method|steps|instructions|directions|procedure|preparation)\s*[:：]?\s*(.*)$/i);

    if (!parsedTitle && /^#{1,6}\s+/.test(line) && cleanedLine && !isAnyRecipeSectionHeading(cleanedLine)) {
      parsedTitle = cleanedLine;
      return;
    }

    if (titleMatch) {
      parsedTitle = titleMatch[2].trim();
      return;
    }

    if (yieldMatch) {
      parsedYield = yieldMatch[2].trim();
      parsedServings = parsedServings ?? parseServingsValue(parsedYield);
      return;
    }

    if (servingsMatch) {
      parsedServings = parseServingsValue(servingsMatch[2].trim());
      if (!parsedYield) {
        parsedYield = servingsMatch[2].trim();
      }
      return;
    }

    if (prepTimeMatch) {
      parsedPrepTime = parseTimeToMinutes(prepTimeMatch[2].trim());
      return;
    }

    if (cookTimeMatch) {
      parsedCookTime = parseTimeToMinutes(cookTimeMatch[2].trim());
      return;
    }

    if (chefNotesMatch) {
      parsedChefNotes = chefNotesMatch[2].trim();
      return;
    }

    if (ingredientsMatch && (isSectionHeading(line, ['ingredients', 'ingredient', 'ingredient list']) || ingredientsMatch[2].trim())) {
      activeSection = 'ingredients';
      if (ingredientsMatch[2].trim()) {
        ingredientLines.push(ingredientsMatch[2].trim());
      }
      return;
    }

    if (methodMatch && (isSectionHeading(line, ['method', 'steps', 'instructions', 'directions', 'procedure', 'preparation']) || methodMatch[2].trim())) {
      activeSection = 'method';
      if (methodMatch[2].trim()) {
        methodLines.push(methodMatch[2].trim());
      }
      return;
    }

    if (!parsedTitle && !line.includes(':') && !isAnyRecipeSectionHeading(cleanedLine) && !lineLooksLikeIngredient) {
      parsedTitle = cleanedLine;
      return;
    }

    if (activeSection === 'ingredients') {
      ingredientLines.push(line);
    } else if (activeSection === 'method') {
      methodLines.push(line);
    } else {
      if (lineLooksLikeIngredient) {
        candidateIngredientLines.push(line);
      }
    }
  });

  if (ingredientLines.length === 0) {
    const ingredientStart = lines.findIndex(line => isSectionHeading(line, ['ingredients', 'ingredient list']));
    const methodStart = lines.findIndex(line => isSectionHeading(line, ['method', 'steps', 'instructions', 'directions', 'procedure', 'preparation']));
    if (ingredientStart >= 0) {
      const end = methodStart > ingredientStart ? methodStart : lines.length;
      ingredientLines.push(...lines.slice(ingredientStart + 1, end));
    }
  }

  if (ingredientLines.length === 0) {
    ingredientLines.push(...candidateIngredientLines);
  }

  if (methodLines.length === 0) {
    const methodStart = lines.findIndex(line => isSectionHeading(line, ['method', 'steps', 'instructions', 'directions', 'procedure', 'preparation']));
    if (methodStart >= 0) {
      methodLines.push(...lines.slice(methodStart + 1));
    }
  }

  return {
    title: parsedTitle || 'Imported Recipe',
    yield: parsedYield,
    servings: parsedServings,
    prepTime: parsedPrepTime,
    cookTime: parsedCookTime,
    chefNotes: parsedChefNotes,
    ingredients: parseIngredientLines(ingredientLines),
    method: methodLines
      .map(cleanImportedLine)
      .filter(Boolean)
      .map((description, index) => ({
        id: `step_import_${Date.now()}_${index}`,
        stepNumber: index + 1,
        description,
        image: ''
      }))
  };
};

const buildImportIngredientError = (parsedRecipe: ReturnType<typeof parsePastedRecipe>) => {
  return [
    parsedRecipe.title ? '✓ Recipe title detected' : '✗ No recipe title detected',
    '',
    '✗ No ingredients detected',
    '',
    'Accepted examples:',
    'Salt: 10 g',
    'Salt | 盐 | 10 g',
    '2斤芋头',
    '鸡粉 5 g',
    'Salt to taste'
  ].join('\n');
};

const isYieldLine = (line: string) => /^(yield|makes|serves|servings)\s*[:：]/i.test(line.trim());

const isLikelyRecipeTitleLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/[:：]$/.test(trimmed)) return false;
  if (/^(ingredients?|method|steps|instructions|directions|procedure|preparation|yield|makes|serves|servings|prep(?:aration)?\s*time|cook(?:ing)?\s*time|bake\s*time|baking\s*time)\b/i.test(trimmed)) return false;
  return /[a-zA-Z]/.test(trimmed);
};

const toParsedImportedRecipe = (rawText: string, index: number): ParsedImportedRecipe | null => {
  const parsedRecipe = parsePastedRecipe(rawText);

  if (!parsedRecipe.title || parsedRecipe.ingredients.length === 0) {
    return null;
  }

  return {
    id: `pdf_recipe_${Date.now()}_${index}`,
    title: parsedRecipe.title,
    description: '',
    yield: parsedRecipe.yield,
    servings: parsedRecipe.servings,
    prepTime: parsedRecipe.prepTime,
    cookTime: parsedRecipe.cookTime,
    chefNotes: '',
    ingredients: parsedRecipe.ingredients,
    method: parsedRecipe.method,
    sourceText: rawText.trim()
  };
};

const detectRecipesFromText = (rawText: string): ParsedImportedRecipe[] => {
  const cleanedText = rawText
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleanedText) return [];

  const explicitRecipeBlocks = cleanedText
    .split(/\n(?=(?:recipe\s*)?title\s*[:：])/i)
    .map(block => block.trim())
    .filter(Boolean);

  if (explicitRecipeBlocks.length > 1) {
    return explicitRecipeBlocks
      .map(toParsedImportedRecipe)
      .filter((recipe): recipe is ParsedImportedRecipe => Boolean(recipe));
  }

  const lines = cleanedText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const ingredientIndexes = lines
    .map((line, index) => (isSectionHeading(line, ['ingredients', 'ingredient', 'ingredient list']) ? index : -1))
    .filter(index => index >= 0);

  if (ingredientIndexes.length > 1) {
    const titleIndexes = ingredientIndexes.map(ingredientIndex => {
      for (let index = ingredientIndex - 1; index >= 0; index -= 1) {
        if (isYieldLine(lines[index])) continue;
        if (isLikelyRecipeTitleLine(lines[index])) return index;
      }
      return ingredientIndex;
    });

    return titleIndexes
      .map((startIndex, index) => {
        const endIndex = titleIndexes[index + 1] ?? lines.length;
        return lines.slice(startIndex, endIndex).join('\n');
      })
      .map(toParsedImportedRecipe)
      .filter((recipe): recipe is ParsedImportedRecipe => Boolean(recipe));
  }

  const singleRecipe = toParsedImportedRecipe(cleanedText, 0);
  return singleRecipe ? [singleRecipe] : [];
};

const extractTextFromPdfFile = async (file: File) => {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map(item => ('str' in item ? item.str : ''))
      .join('\n');
    pageTexts.push(pageText);
  }

  return pageTexts.join('\n\n');
};

const normalizeAiNumber = (value: number | string | null | undefined, parser = parseTimeToMinutes) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string') return parser(value);
  return null;
};

const extractStructuredRecipeFromScan = async (
  file: File,
  scannedImageDataUrl: string,
  onStage?: (stage: 'reading' | 'extracting') => void
): Promise<ParsedImportedRecipe> => {
  const scannedRecipe = await scanRecipeImageWithGemini({ file, imageDataUrl: scannedImageDataUrl, onStage });
  const ingredientLines = scannedRecipe.ingredients.map(ingredient =>
    [ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(' ')
  );
  const methodLines = scannedRecipe.method;
  const title = scannedRecipe.title.trim();

  const recipeObject = {
    id: `scan_recipe_${Date.now()}`,
    title,
    description: scannedRecipe.description.trim(),
    yield: scannedRecipe.yield.trim(),
    servings: normalizeAiNumber(scannedRecipe.servings, parseServingsValue) ?? normalizeAiNumber(scannedRecipe.yield, parseServingsValue),
    prepTime: normalizeAiNumber(scannedRecipe.prepTime),
    cookTime: normalizeAiNumber(scannedRecipe.cookTime),
    chefNotes: scannedRecipe.notes.trim(),
    scannedImageDataUrl,
    ingredients: parseIngredientLines(ingredientLines),
    method: methodLines
      .map(line => cleanImportedLine(String(line)))
      .filter(Boolean)
      .map((description, index) => ({
        id: `step_scan_${Date.now()}_${index}`,
        stepNumber: index + 1,
        description,
        image: ''
      })),
    sourceText: [
      title,
      scannedRecipe.yield ? `Yield: ${scannedRecipe.yield}` : '',
      scannedRecipe.servings ? `Servings: ${scannedRecipe.servings}` : '',
      scannedRecipe.prepTime ? `Prep Time: ${scannedRecipe.prepTime}` : '',
      scannedRecipe.cookTime ? `Cook Time: ${scannedRecipe.cookTime}` : '',
      '',
      'Ingredients',
      ...ingredientLines,
      '',
      'Method',
      ...methodLines,
      scannedRecipe.notes ? `Chef Notes: ${scannedRecipe.notes}` : ''
    ].filter(Boolean).join('\n')
  };

  return recipeObject;
};

const getDataUrlBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
};

const loadImageFromFile = (file: File) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to read uploaded image.'));
    };

    image.src = objectUrl;
  });
};

const drawImageToJpegDataUrl = (
  image: HTMLImageElement,
  width: number,
  height: number,
  quality: number
) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to optimize image.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', quality);
};

const drawImageToCanvas = (image: HTMLImageElement, width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to optimize image.');
  }

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const canvasHasTransparency = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < imageData.length; index += 4) {
    if (imageData[index] < 255) return true;
  }

  return false;
};

const optimizeScanImageFile = async (file: File) => {
  const image = await loadImageFromFile(file);
  const longestSide = Math.max(image.width, image.height);
  const scale = longestSide > MAX_SCAN_IMAGE_SIDE ? MAX_SCAN_IMAGE_SIDE / longestSide : 1;
  const width = image.width * scale;
  const height = image.height * scale;
  const canvas = drawImageToCanvas(image, width, height);
  const hasTransparency = canvasHasTransparency(canvas);
  let optimizedDataUrl: string;

  if (hasTransparency) {
    optimizedDataUrl = canvas.toDataURL('image/png');
  } else {
    optimizedDataUrl = canvas.toDataURL('image/jpeg', SCAN_JPEG_QUALITY);
  }

  const originalSize = file.size;
  const compressedSize = getDataUrlBytes(optimizedDataUrl);
  const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;
  console.log('Original size', originalSize);
  console.log('Compressed size', compressedSize);
  console.log('Compression ratio', compressionRatio);

  return optimizedDataUrl;
};

const optimizeCoverImageFile = async (file: File) => {
  const image = await loadImageFromFile(file);
  const longestSide = Math.max(image.width, image.height);
  const initialScale = longestSide > MAX_COVER_IMAGE_SIDE ? MAX_COVER_IMAGE_SIDE / longestSide : 1;
  let width = image.width * initialScale;
  let height = image.height * initialScale;
  let quality = INITIAL_JPEG_QUALITY;
  let optimizedDataUrl = drawImageToJpegDataUrl(image, width, height, quality);
  let attempts = 0;

  while (getDataUrlBytes(optimizedDataUrl) > MAX_COVER_IMAGE_BYTES && attempts < 60) {
    attempts += 1;
    if (quality > 0.35) {
      quality = Math.max(0.35, quality - 0.08);
    } else {
      width *= 0.85;
      height *= 0.85;
      quality = INITIAL_JPEG_QUALITY;
    }

    optimizedDataUrl = drawImageToJpegDataUrl(image, width, height, quality);
  }

  if (getDataUrlBytes(optimizedDataUrl) > MAX_COVER_IMAGE_BYTES) {
    throw new Error('Uploaded image is too large to save. Please choose a smaller cover photo.');
  }

  return optimizedDataUrl;
};

interface AddRecipeTabProps {
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
  categories: RecipeCategory[];
  onCreateCategory: (name: string) => RecipeCategory | null;
  onRenameCategory: (categoryId: string, nextName: string) => void;
  onDeleteCategory: (categoryId: string, targetCategoryName: string) => void;
  initialRecipe?: Recipe | null;
  mode?: 'add' | 'edit';
  userRole?: UserRole;
}

export default function AddRecipeTab({
  onSave,
  onCancel,
  categories,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  initialRecipe = null,
  mode = 'add',
  userRole = 'user'
}: AddRecipeTabProps) {
  const isEditing = mode === 'edit' && initialRecipe;

  // Base details state
  const [title, setTitle] = useState(initialRecipe?.title || '');
  const [coverImage, setCoverImage] = useState(initialRecipe?.coverImage || '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialRecipe
      ? normalizeRecipeCategories(getRecipeCategories(initialRecipe).filter(category => category !== FALLBACK_CATEGORY_NAME))
      : []
  );
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [openCategoryMenuId, setOpenCategoryMenuId] = useState<string | null>(null);
  const [renamingCategory, setRenamingCategory] = useState<RecipeCategory | null>(null);
  const [renameCategoryName, setRenameCategoryName] = useState('');
  const [prepTime, setPrepTime] = useState<number>(initialRecipe?.prepTime || 30);
  const [cookTime, setCookTime] = useState<number>(initialRecipe?.cookTime || 0);
  const [servings, setServings] = useState<number>(initialRecipe?.servings || 2);
  const [recipeYield, setRecipeYield] = useState(initialRecipe?.yield || (initialRecipe ? `${initialRecipe.servings} servings` : ''));
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>(initialRecipe?.difficulty || 'Easy');
  
  // Chef's story
  const [story, setStory] = useState(initialRecipe?.story || '');
  const [chefNotes, setChefNotes] = useState(initialRecipe?.chefNotes || '');
  const [scannedImageDataUrl, setScannedImageDataUrl] = useState(initialRecipe?.scannedImageDataUrl || '');

  // Ingredients state
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initialRecipe?.ingredients?.length
      ? initialRecipe.ingredients
      : [{ id: 'ing_1', name: '', qty: '', unit: '' }]
  );
  const [importedIngredientIds, setImportedIngredientIds] = useState<string[]>([]);

  // Method steps state
  const [methodSteps, setMethodSteps] = useState<MethodStep[]>(
    initialRecipe?.method?.length
      ? initialRecipe.method
      : [{ id: 'step_1', stepNumber: 1, description: '', image: '' }]
  );
  const [isGeneratingSteps, setIsGeneratingSteps] = useState(false);
  const [aiStepError, setAiStepError] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'text' | 'pdf' | 'image' | 'camera'>('text');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const [aiImportStage, setAiImportStage] = useState<AiImportStage | null>(null);
  const [detectedPdfRecipes, setDetectedPdfRecipes] = useState<ParsedImportedRecipe[]>([]);
  const [selectedPdfRecipeIds, setSelectedPdfRecipeIds] = useState<string[]>([]);

  // Media
  const [videoLink, setVideoLink] = useState(initialRecipe?.videoLink || '');

  // Local helper for cover photo selection
  const handleCoverPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const optimizedImage = await optimizeCoverImageFile(file);
        setCoverImage(optimizedImage);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Unable to optimize uploaded image.');
      }
    }
  };

  // Local helper for step photo selection
  const handleStepPhotoChange = (stepId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setMethodSteps(prev =>
            prev.map(step => (step.id === stepId ? { ...step, image: event.target?.result as string } : step))
          );
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Add Row methods
  const addIngredientRow = () => {
    setIngredients(prev => [
      ...prev,
      { id: `ing_${Date.now()}_${Math.random()}`, name: '', qty: '', unit: '' }
    ]);
  };

  const removeIngredientRow = (id: string) => {
    if (ingredients.length === 1) return;
    setIngredients(prev => prev.filter(ing => ing.id !== id));
  };

  const updateIngredient = (id: string, field: keyof Ingredient, value: string) => {
    setIngredients(prev =>
      prev.map(ing => (ing.id === id ? { ...ing, [field]: value } : ing))
    );
  };

  const shouldShowAddToDictionary = (ingredient: Ingredient) => {
    return canAccessKitchenDictionary(userRole)
      && importedIngredientIds.includes(ingredient.id)
      && Boolean(ingredient.name.trim())
      && !isKnownKitchenDictionaryIngredientName(ingredient.name);
  };

  const categoryOptions = categories.filter(category => category.name !== FALLBACK_CATEGORY_NAME);

  const toggleCategory = (categoryName: string) => {
    setSelectedCategories(prev => {
      const isSelected = prev.some(item => item.toLowerCase() === categoryName.toLowerCase());
      const nextCategories = isSelected
        ? prev.filter(item => item.toLowerCase() !== categoryName.toLowerCase())
        : [...prev, categoryName];

      return nextCategories;
    });
  };

  const removeSelectedCategory = (categoryName: string) => {
    setSelectedCategories(prev => {
      const nextCategories = prev.filter(item => item.toLowerCase() !== categoryName.toLowerCase());
      return nextCategories;
    });
  };

  const handleCreateCategoryFromForm = () => {
    const newCategory = onCreateCategory(newCategoryName);
    if (newCategory) {
      setSelectedCategories(prev => normalizeRecipeCategories([...prev, newCategory.name]));
      setNewCategoryName('');
      setShowCategoryCreator(false);
    }
  };

  const startRenameCategory = (category: RecipeCategory) => {
    setRenamingCategory(category);
    setRenameCategoryName(category.name);
    setOpenCategoryMenuId(null);
  };

  const handleRenameCategoryFromForm = () => {
    if (!renamingCategory) return;
    const nextName = renameCategoryName.trim();
    if (!nextName) return;

    onRenameCategory(renamingCategory.id, nextName);
    setSelectedCategories(prev =>
      normalizeRecipeCategories(prev.map(categoryName =>
        categoryName.toLowerCase() === renamingCategory.name.toLowerCase() ? nextName : categoryName
      ))
    );
    setRenamingCategory(null);
    setRenameCategoryName('');
  };

  const handleDeleteCategoryFromForm = (category: RecipeCategory) => {
    setOpenCategoryMenuId(null);
    const confirmed = window.confirm(`Delete "${category.name}"?\n\nThis will remove the category from recipes that use it. Recipes will not be deleted.`);
    if (!confirmed) return;

    onDeleteCategory(category.id, '');
    setSelectedCategories(prev =>
      prev.filter(categoryName => categoryName.toLowerCase() !== category.name.toLowerCase())
    );
  };

  const addMethodStepRow = () => {
    setMethodSteps(prev => [
      ...prev,
      {
        id: `step_${Date.now()}_${Math.random()}`,
        stepNumber: prev.length + 1,
        description: '',
        image: ''
      }
    ]);
  };

  const removeMethodStepRow = (id: string) => {
    if (methodSteps.length === 1) return;
    const filtered = methodSteps.filter(step => step.id !== id);
    // Re-index step numbers
    const reindexed = filtered.map((step, idx) => ({ ...step, stepNumber: idx + 1 }));
    setMethodSteps(reindexed);
  };

  const updateMethodStep = (id: string, description: string) => {
    setMethodSteps(prev =>
      prev.map(step => (step.id === id ? { ...step, description } : step))
    );
  };

  const moveMethodStep = (id: string, direction: 'up' | 'down') => {
    setMethodSteps(prev => {
      const currentIndex = prev.findIndex(step => step.id === id);
      if (currentIndex === -1) return prev;

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const reordered = [...prev];
      const [movedStep] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedStep);

      return reordered.map((step, idx) => ({ ...step, stepNumber: idx + 1 }));
    });
  };

  const handleAutoWriteSteps = async () => {
    setAiStepError('');

    if (!title.trim()) {
      setAiStepError('Add a recipe title before generating steps.');
      return;
    }

    const cleanIngredients = ingredients
      .filter(ing => ing.name.trim() !== '')
      .map(normalizeIngredientForDisplay);
    if (cleanIngredients.length === 0) {
      setAiStepError('Add at least one ingredient before generating steps.');
      return;
    }

    const hasExistingSteps = methodSteps.some(step => step.description.trim() || step.image);
    if (hasExistingSteps && !window.confirm('Replace current steps with AI draft?')) {
      return;
    }

    try {
      setIsGeneratingSteps(true);
      const draftSteps = await generateRecipeStepsWithAI({
        title: title.trim(),
        category: selectedCategories.join(', '),
        yield: recipeYield.trim(),
        ingredients: cleanIngredients.map(ing => ({
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit
        }))
      });
      if (draftSteps.length === 0) {
        throw new Error('AI returned no method steps.');
      }

      setMethodSteps(draftSteps.map((description, idx) => ({
        id: `step_ai_${Date.now()}_${idx}`,
        stepNumber: idx + 1,
        description,
        image: ''
      })));
    } catch (err) {
      setAiStepError(err instanceof Error ? err.message : 'Unable to generate method steps.');
    } finally {
      setIsGeneratingSteps(false);
    }
  };

  const handleImportRecipe = () => {
    setImportError('');
    const parsedRecipe = parsePastedRecipe(importText);

    if (parsedRecipe.ingredients.length === 0) {
      setImportError(buildImportIngredientError(parsedRecipe));
      return;
    }

    importRecipeToEditor({
      title: parsedRecipe.title,
      description: '',
      yield: parsedRecipe.yield,
      servings: parsedRecipe.servings,
      prepTime: parsedRecipe.prepTime,
      cookTime: parsedRecipe.cookTime,
      chefNotes: parsedRecipe.chefNotes,
      ingredients: parsedRecipe.ingredients,
      method: parsedRecipe.method
    });
    setShowImportModal(false);
    setImportText('');
  };

  const showDetectedRecipesForImport = (recipes: ParsedImportedRecipe[]) => {
    setDetectedPdfRecipes(recipes);
    setSelectedPdfRecipeIds(recipes.length === 1 ? [recipes[0].id] : []);
    setImportError('');
  };

  const handleImportedText = (rawText: string, emptyMessage = 'No recipe text was found.') => {
    const detectedRecipes = detectRecipesFromText(rawText);

    if (detectedRecipes.length === 0) {
      setDetectedPdfRecipes([]);
      setSelectedPdfRecipeIds([]);
      setImportError(emptyMessage);
      return;
    }

    showDetectedRecipesForImport(detectedRecipes);
  };

  const importRecipeToEditor = (
    recipe: Pick<ParsedImportedRecipe, 'title' | 'description' | 'yield' | 'servings' | 'prepTime' | 'cookTime' | 'chefNotes' | 'scannedImageDataUrl' | 'ingredients' | 'method'>
  ) => {
    setTitle(recipe.title);
    if (recipe.description) setStory(recipe.description);
    setRecipeYield(recipe.yield || recipeYield);
    if (recipe.servings) setServings(recipe.servings);
    if (recipe.prepTime) setPrepTime(recipe.prepTime);
    if (recipe.cookTime) setCookTime(recipe.cookTime);
    if (recipe.chefNotes) setChefNotes(recipe.chefNotes);
    if (recipe.scannedImageDataUrl) setScannedImageDataUrl(recipe.scannedImageDataUrl);
    setIngredients(recipe.ingredients);
    setImportedIngredientIds(recipe.ingredients.map(ingredient => ingredient.id));
    setMethodSteps(recipe.method.length > 0
      ? recipe.method
      : [{ id: `step_import_blank_${Date.now()}`, stepNumber: 1, description: '', image: '' }]
    );
  };

  const handlePdfFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isReadingPdf) {
      e.target.value = '';
      return;
    }

    setImportError('');
    setDetectedPdfRecipes([]);
    setSelectedPdfRecipeIds([]);

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setImportError('Please upload a PDF file.');
      return;
    }

    try {
      setIsReadingPdf(true);
      const extractedText = await extractTextFromPdfFile(file);
      handleImportedText(
        extractedText,
        'No complete recipes were detected. The PDF needs selectable text with title, ingredients, and method sections.'
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to read this PDF.');
    } finally {
      setIsReadingPdf(false);
      e.target.value = '';
    }
  };

  const handleImageImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isReadingPdf) {
      e.target.value = '';
      return;
    }

    setImportError('');
    setDetectedPdfRecipes([]);
    setSelectedPdfRecipeIds([]);

    if (!file.type.startsWith('image/')) {
      setImportError('Please choose an image file.');
      return;
    }

    try {
      setIsReadingPdf(true);
      setAiImportStage('uploading');
      const optimizedScanImage = await optimizeScanImageFile(file);
      const scannedRecipe = await extractStructuredRecipeFromScan(file, optimizedScanImage, setAiImportStage);
      setAiImportStage('building');
      showDetectedRecipesForImport([scannedRecipe]);
      setAiImportStage('ready');
      setImportText(scannedRecipe.sourceText);
      setImportError('');
    } catch (err) {
      setAiImportStage(null);
      setImportError(err instanceof Error ? err.message : 'Unable to scan this recipe image.');
    } finally {
      setIsReadingPdf(false);
      e.target.value = '';
    }
  };

  const handleScanRecipeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isReadingPdf) {
      e.target.value = '';
      return;
    }

    setImportError('');
    setDetectedPdfRecipes([]);
    setSelectedPdfRecipeIds([]);

    if (!file.type.startsWith('image/')) {
      setImportError('Please take or choose a recipe photo.');
      return;
    }

    try {
      setIsReadingPdf(true);
      setAiImportStage('uploading');
      const optimizedScanImage = await optimizeScanImageFile(file);
      const scannedRecipe = await extractStructuredRecipeFromScan(file, optimizedScanImage, setAiImportStage);
      setAiImportStage('building');
      showDetectedRecipesForImport([scannedRecipe]);
      setImportText(scannedRecipe.sourceText);
      setAiImportStage('ready');
      setImportError('');
    } catch (err) {
      setAiImportStage(null);
      setImportError(err instanceof Error ? err.message : 'Unable to scan this recipe.');
    } finally {
      setIsReadingPdf(false);
      e.target.value = '';
    }
  };

  const togglePdfRecipeSelection = (recipeId: string) => {
    setSelectedPdfRecipeIds(prev =>
      prev.includes(recipeId)
        ? prev.filter(id => id !== recipeId)
        : [...prev, recipeId]
    );
  };

  const handleImportSelectedRecipes = () => {
    setImportError('');
    const selectedRecipes = detectedPdfRecipes.filter(recipe => selectedPdfRecipeIds.includes(recipe.id));

    if (selectedRecipes.length === 0) {
      setImportError('Select at least one detected recipe to import.');
      return;
    }

    importRecipeToEditor(selectedRecipes[0]);
    setShowImportModal(false);
  };

  const handleImportButtonClick = () => {
    if (detectedPdfRecipes.length > 0) {
      handleImportSelectedRecipes();
      return;
    }

    handleImportRecipe();
  };

  // Handle Save
  const handleSaveClick = () => {
    if (!title.trim()) {
      alert('Please give your recipe a title!');
      return;
    }

    // Filter empty ingredients
    const cleanIngredients = ingredients
      .filter(ing => ing.name.trim() !== '')
      .map(normalizeIngredientForDisplay);
    if (cleanIngredients.length === 0) {
      alert('Please add at least one ingredient name!');
      return;
    }

    // Filter empty steps
    const cleanSteps = methodSteps.filter(step => step.description.trim() !== '');
    if (cleanSteps.length === 0) {
      alert('Please describe at least one cooking step!');
      return;
    }

    const savedCategories = normalizeRecipeCategories(selectedCategories);
    const finalCategories = savedCategories;
    const primaryCategory = finalCategories[0] || '';

    const savedServings = Number(servings) || 2;

    const savedRecipe: Recipe = {
      id: initialRecipe?.id || `recipe_${Date.now()}`,
      title: title.trim(),
      coverImage: coverImage || 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&q=80&w=800',
      imageUrl: initialRecipe?.imageUrl,
      scanAttachmentUrl: initialRecipe?.scanAttachmentUrl,
      scannedImageDataUrl: scannedImageDataUrl || undefined,
      category: primaryCategory,
      categories: finalCategories,
      prepTime: Number(prepTime) || 30,
      cookTime: Number(cookTime) || undefined,
      servings: savedServings,
      yield: recipeYield.trim() || `${savedServings} servings`,
      difficulty,
      story: story.trim() || 'A homemade culinary masterpiece baked with fresh herbs and careful attention.',
      chefNotes: chefNotes.trim(),
      ingredients: cleanIngredients,
      method: cleanSteps,
      videoLink: videoLink.trim(),
      chefName: initialRecipe?.chefName || 'User Log',
      chefAvatar: initialRecipe?.chefAvatar,
      isSaved: initialRecipe?.isSaved || false,
      collections: initialRecipe?.collections || [],
      createdAt: initialRecipe?.createdAt || new Date().toISOString(),
      tags: initialRecipe?.tags,
      isFeatured: initialRecipe?.isFeatured
    };

    onSave(savedRecipe);
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <section className="bg-surface-container-low border border-surface-container-high p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div>
          <h2 className="font-display text-xl font-bold text-primary">Recipe Entry</h2>
          <p className="font-sans text-xs text-on-surface-variant font-bold">
            Paste an existing recipe to quickly fill the form, then review before saving.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setImportError('');
            setShowImportModal(true);
          }}
          className="self-start sm:self-auto bg-primary text-on-primary rounded-full px-4 py-2.5 font-sans font-bold text-xs flex items-center gap-2 active:scale-95 transition-all"
        >
          <FileText className="w-4 h-4" />
          Import Recipe
        </button>
      </section>

      {/* Photo Upload Area */}
      <section>
        <label className="block group relative w-full aspect-[16/9] md:aspect-[21/9] rounded-2xl border-2 border-dashed border-outline-variant bg-surface-container-low overflow-hidden cursor-pointer hover:border-primary transition-all">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            onChange={handleCoverPhotoChange}
          />
          {coverImage ? (
            <img
              className="w-full h-full object-cover transition-transform group-hover:scale-102 duration-500"
              src={coverImage}
              alt="Cover preview"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-on-surface-variant group-hover:text-primary transition-colors">
              <Camera className="w-8 h-8 text-outline" />
              <span className="font-sans font-bold text-sm">{isEditing ? 'Change Cover Photo' : 'Add Cover Photo'}</span>
            </div>
          )}
        </label>
      </section>

      {/* Basic Title Info */}
      <section className="space-y-6">
        <div>
          <input
            type="text"
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Give your recipe a title..."
            className="w-full bg-transparent border-none p-0 font-display font-bold text-3xl sm:text-4.5xl text-primary placeholder:text-outline-variant focus:ring-0 leading-tight"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="font-sans font-bold text-xs text-on-surface-variant/90 px-1">Categories</label>
            <div className="relative space-y-2">
              <div className="min-h-[48px] bg-surface-container rounded-2xl px-3 py-2 flex flex-wrap items-center gap-2 border border-transparent focus-within:border-primary transition-all">
                {selectedCategories.length > 0 ? (
                  selectedCategories.map(item => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => removeSelectedCategory(item)}
                      className="bg-primary text-on-primary rounded-full px-3 py-1.5 font-sans text-[11px] font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                      title={`Remove ${item}`}
                    >
                      {item}
                      <X className="w-3 h-3 opacity-80" />
                    </button>
                  ))
                ) : (
                  <span className="px-1 font-sans text-xs font-bold text-outline">
                    Select categories
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {categoryOptions.map(item => {
                  const isSelected = selectedCategories.some(categoryName => categoryName.toLowerCase() === item.name.toLowerCase());
                  return (
                    <div key={item.id} className="relative">
                      <div
                        className={`flex items-center rounded-full border transition-all ${
                          isSelected
                            ? 'bg-primary text-on-primary border-primary'
                            : 'bg-white text-primary border-surface-container-high hover:border-primary'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleCategory(item.name)}
                          className="rounded-l-full pl-3 pr-1 py-2 font-sans text-[11px] font-bold transition-all"
                        >
                          {item.name}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenCategoryMenuId(prev => prev === item.id ? null : item.id);
                          }}
                          className={`mr-1 rounded-full p-1 transition-all ${
                            isSelected
                              ? 'text-on-primary hover:bg-white/15'
                              : 'text-outline hover:bg-surface-container-high hover:text-primary'
                          }`}
                          aria-label={`Manage ${item.name}`}
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {openCategoryMenuId === item.id && (
                        <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-2xl border border-surface-container-high bg-background p-1.5 shadow-xl shadow-primary/10">
                          <button
                            type="button"
                            onClick={() => startRenameCategory(item)}
                            className="w-full rounded-xl px-3 py-2 text-left font-sans text-xs font-bold text-primary hover:bg-surface-container transition-all"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCategoryFromForm(item)}
                            className="w-full rounded-xl px-3 py-2 text-left font-sans text-xs font-bold text-red-600 hover:bg-red-50 transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowCategoryCreator(prev => !prev)}
                  className="rounded-full px-3 py-2 font-sans text-[11px] font-bold border border-dashed border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 active:scale-95 transition-all flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create New Category
                </button>
              </div>

              {showCategoryCreator && (
                <div className="absolute left-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-surface-container-high bg-background p-3 shadow-2xl shadow-primary/10 space-y-3">
                  <div>
                    <p className="font-display text-base font-semibold text-primary">New category</p>
                    <p className="font-sans text-[11px] font-bold text-on-surface-variant">
                      Add it to this recipe right away.
                    </p>
                  </div>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateCategoryFromForm();
                      }
                      if (e.key === 'Escape') {
                        setShowCategoryCreator(false);
                      }
                    }}
                    placeholder="Bakery, Pastry, Kids Menu..."
                    autoFocus
                    className="w-full bg-surface-container border border-surface-container-high rounded-xl font-sans text-sm text-on-surface px-4 py-3 focus:ring-1 focus:ring-primary font-bold placeholder:text-outline"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCategoryCreator(false);
                        setNewCategoryName('');
                      }}
                      className="flex-1 rounded-full bg-surface-container px-4 py-2.5 font-sans text-xs font-bold text-primary active:scale-95 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCategoryFromForm}
                      className="flex-1 rounded-full bg-primary px-4 py-2.5 font-sans text-xs font-bold text-on-primary active:scale-95 transition-all"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}

              {renamingCategory && (
                <div className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-sm rounded-2xl border border-surface-container-high bg-background p-5 shadow-2xl space-y-4">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-primary">Rename category</h3>
                      <p className="font-sans text-xs font-bold text-on-surface-variant">
                        Recipes using this category will update automatically.
                      </p>
                    </div>
                    <input
                      type="text"
                      value={renameCategoryName}
                      onChange={e => setRenameCategoryName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleRenameCategoryFromForm();
                        }
                        if (e.key === 'Escape') {
                          setRenamingCategory(null);
                        }
                      }}
                      autoFocus
                      className="w-full rounded-xl border border-surface-container-high bg-surface-container px-4 py-3 font-sans text-sm font-bold text-on-surface focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingCategory(null);
                          setRenameCategoryName('');
                        }}
                        className="flex-1 rounded-full bg-surface-container px-4 py-2.5 font-sans text-xs font-bold text-primary active:scale-95 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleRenameCategoryFromForm}
                        className="flex-1 rounded-full bg-primary px-4 py-2.5 font-sans text-xs font-bold text-on-primary active:scale-95 transition-all"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-sans font-bold text-xs text-on-surface-variant/90 px-1">Prep Time</label>
            <div className="relative">
              <input
                type="number"
                min="5"
                value={prepTime}
                onChange={e => setPrepTime(Number(e.target.value))}
                placeholder="30"
                className="w-full bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm text-on-surface pl-4 pr-12 py-3.5 focus:ring-1 focus:ring-primary font-bold"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-sans font-bold text-outline">
                MIN
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-sans font-bold text-xs text-on-surface-variant/90 px-1">Cook Time</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                value={cookTime}
                onChange={e => setCookTime(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm text-on-surface pl-4 pr-12 py-3.5 focus:ring-1 focus:ring-primary font-bold"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-sans font-bold text-outline">
                MIN
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-sans font-bold text-xs text-on-surface-variant/90 px-1">Servings</label>
            <input
              type="number"
              min="1"
              value={servings}
              onChange={e => setServings(Number(e.target.value))}
              placeholder="2"
              className="w-full bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm text-on-surface px-4 py-3.5 focus:ring-1 focus:ring-primary font-bold"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-sans font-bold text-xs text-on-surface-variant/90 px-1">Difficulty</label>
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value as any)}
              className="w-full bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm text-on-surface px-4 py-3.5 focus:ring-1 focus:ring-primary font-bold cursor-pointer transition-all"
            >
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="font-sans font-bold text-xs text-on-surface-variant/90 px-1">Yield</label>
          <input
            type="text"
            value={recipeYield}
            onChange={e => setRecipeYield(e.target.value)}
            placeholder="e.g. 12 pcs, 20 servings, 1 loaf"
            className="w-full bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm text-on-surface px-4 py-3.5 focus:ring-1 focus:ring-primary font-bold"
          />
        </div>
      </section>

      {/* Chef's Story Section */}
      <section className="bg-surface-container-low p-5 rounded-2xl border border-surface-container flex flex-col gap-4 shadow-sm">
        <h3 className="font-display text-xl font-semibold text-primary flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-secondary animate-pulse" />
          Story
        </h3>
        <textarea
          value={story}
          onChange={e => setStory(e.target.value)}
          placeholder="Tell us the story behind this recipe. Is it a family heirloom? Inspired by a recent trip?"
          rows={4}
          className="w-full bg-white border-none rounded-xl font-sans text-sm text-on-surface p-4 focus:ring-1 focus:ring-primary resize-none placeholder:text-outline-variant font-medium leading-relaxed"
        />
      </section>

      <section className="bg-surface-container-low p-5 rounded-2xl border border-surface-container flex flex-col gap-4 shadow-sm">
        <h3 className="font-display text-xl font-semibold text-primary">
          Chef Notes
        </h3>
        <textarea
          value={chefNotes}
          onChange={e => setChefNotes(e.target.value)}
          placeholder="Add private notes, reminders, or cooking adjustments..."
          rows={3}
          className="w-full bg-white border-none rounded-xl font-sans text-sm text-on-surface p-4 focus:ring-1 focus:ring-primary resize-none placeholder:text-outline-variant font-medium leading-relaxed"
        />
      </section>

      {/* Ingredients List */}
      <section className="space-y-4" id="ingredients-section">
        <h3 className="font-display text-2xl font-bold text-primary tracking-tight">Ingredients</h3>
        
        <div className="space-y-2.5" id="ingredient-list">
          {ingredients.map((ing) => (
            <div key={ing.id} className="grid grid-cols-2 sm:grid-cols-[1fr_80px_100px_1fr_40px] gap-2 items-center animate-fade-in">
              <input
                type="text"
                placeholder="Ingredient name (e.g., Fresh Basil)"
                value={ing.name}
                onChange={e => updateIngredient(ing.id, 'name', e.target.value)}
                className="bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm p-4 font-semibold col-span-2 sm:col-span-1"
              />
              <input
                type="text"
                placeholder="Qty"
                value={ing.qty}
                onChange={e => updateIngredient(ing.id, 'qty', e.target.value)}
                className="bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm p-4 font-semibold text-center"
              />
              <input
                type="text"
                placeholder="Unit"
                list="ingredient-unit-options"
                value={ing.unit}
                onChange={e => updateIngredient(ing.id, 'unit', e.target.value)}
                className="bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm p-4 font-semibold text-center"
              />
              <input
                type="text"
                placeholder="Notes"
                value={ing.notes || ''}
                onChange={e => updateIngredient(ing.id, 'notes', e.target.value)}
                className="bg-surface-container border-none rounded-xl font-sans text-xs sm:text-sm p-4 font-semibold col-span-2 sm:col-span-1"
              />
              <button
                type="button"
                onClick={() => removeIngredientRow(ing.id)}
                disabled={ingredients.length === 1}
                className="text-outline hover:text-error transition-colors p-2 flex items-center justify-center disabled:opacity-30 col-span-2 sm:col-span-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {shouldShowAddToDictionary(ing) && (
                <button
                  type="button"
                  className="col-span-2 sm:col-span-full justify-self-start rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10"
                >
                  Add to Kitchen Dictionary
                </button>
              )}
            </div>
          ))}
        </div>
        <datalist id="ingredient-unit-options">
          <option value="g" />
          <option value="kg" />
          <option value="ml" />
          <option value="L" />
          <option value="pcs" />
          <option value="cloves" />
          <option value="tsp" />
          <option value="tbsp" />
          <option value="cups" />
        </datalist>

        <button
          type="button"
          onClick={addIngredientRow}
          className="flex items-center gap-2 text-primary hover:text-secondary font-sans font-bold text-sm bg-primary/10 hover:bg-primary/15 px-4 py-2.5 rounded-full transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Ingredient
        </button>
      </section>

      {/* Method Section */}
      <section className="space-y-4" id="method-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="font-display text-2xl font-bold text-primary tracking-tight">Method</h3>
          <button
            type="button"
            onClick={handleAutoWriteSteps}
            disabled={isGeneratingSteps}
            className="self-start sm:self-auto bg-secondary text-white disabled:bg-outline-variant rounded-full px-4 py-2.5 font-sans font-bold text-xs active:scale-95 transition-all"
          >
            {isGeneratingSteps ? 'Writing Steps...' : '✨ Auto Write Steps'}
          </button>
        </div>

        {aiStepError && (
          <div className="bg-secondary/10 border border-secondary/20 text-secondary rounded-xl p-3 font-sans text-xs font-bold">
            {aiStepError}
          </div>
        )}
        
        <div className="space-y-5" id="steps-list">
          {methodSteps.map((step, index) => (
            <div
              key={step.id}
              className="bg-white p-5 rounded-2xl shadow-sm border border-surface-container-high space-y-4"
            >
              <div className="flex justify-between items-center">
                <span className="font-sans font-extrabold text-xs tracking-wider text-secondary">
                  STEP {step.stepNumber}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveMethodStep(step.id, 'up')}
                    disabled={index === 0}
                    className="text-outline hover:text-primary transition-colors disabled:opacity-30 p-1"
                    title="Move step up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMethodStep(step.id, 'down')}
                    disabled={index === methodSteps.length - 1}
                    className="text-outline hover:text-primary transition-colors disabled:opacity-30 p-1"
                    title="Move step down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMethodStepRow(step.id)}
                    disabled={methodSteps.length === 1}
                    className="text-outline hover:text-red-500 transition-colors disabled:opacity-30 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex gap-4 flex-col sm:flex-row items-stretch">
                <label className="shrink-0 w-24 h-24 rounded-xl bg-surface-container flex items-center justify-center cursor-pointer border border-dashed border-outline-variant hover:border-primary overflow-hidden relative self-start sm:self-auto">
                  <input
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={e => handleStepPhotoChange(step.id, e)}
                  />
                  {step.image ? (
                    <img
                      src={step.image}
                      alt={`Step ${step.stepNumber}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-outline-variant" />
                  )}
                </label>
                <textarea
                  placeholder="Describe this step in detail..."
                  value={step.description}
                  onChange={e => updateMethodStep(step.id, e.target.value)}
                  rows={3}
                  className="flex-1 bg-surface-container-lowest border-none rounded-xl font-sans text-sm p-4 focus:ring-1 focus:ring-primary resize-none placeholder:text-outline-variant font-medium leading-relaxed"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addMethodStepRow}
          className="flex items-center gap-2 text-primary hover:text-secondary font-sans font-bold text-sm bg-primary/10 hover:bg-primary/15 px-4 py-2.5 rounded-full transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add Step
        </button>
      </section>

      {/* Video URL section */}
      <section className="bg-surface-container-low p-5 rounded-2xl border border-surface-container flex flex-col justify-between shadow-sm">
        <h3 className="font-sans font-bold text-xs tracking-wider text-primary uppercase pb-4 border-b border-surface-container font-sans flex items-center gap-1">
          <Video className="w-4 h-4 text-secondary" /> Video URL
        </h3>
        <div className="pt-4">
          <label className="text-[10px] font-sans font-bold text-on-surface-variant block mb-1">
            Video URL
          </label>
          <input
            type="url"
            value={videoLink}
            onChange={e => setVideoLink(e.target.value)}
            placeholder="https://youtube.com/..."
            className="w-full bg-white border border-outline-variant/20 rounded-xl px-4 py-3 text-xs font-semibold placeholder:text-outline-variant"
          />
        </div>
      </section>

      {/* Primary Floating Save Bar on bottom of screen (desktop has top nav Save, mobile also has this convenient one!) */}
      <div className="sticky bottom-6 flex gap-4 pt-4 z-40 bg-surface/10 backdrop-blur-md p-2 rounded-2xl max-w-sm mx-auto sm:hidden shadow-lg border border-primary/5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3.5 bg-surface-container hover:bg-surface-container-high rounded-full font-sans font-bold text-xs text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveClick}
          className="flex-1 py-3.5 bg-primary hover:bg-primary-container text-on-primary rounded-full font-sans font-bold text-xs transition-colors shadow-md shadow-primary/25"
        >
          {isEditing ? 'Save Changes' : 'Save Recipe'}
        </button>
      </div>

      {/* Hidden button for App.tsx trigger */}
      <button id="add-recipe-hidden-save-btn" onClick={handleSaveClick} className="hidden" />

      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border border-surface-container-high rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-xl font-bold text-primary">Import Recipe</h3>
                <p className="font-sans text-xs text-on-surface-variant font-bold">
                  Add a recipe from text, PDF, image, or camera. MiseChef will fill the editor for review before saving.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-2 rounded-full hover:bg-surface-container text-outline"
                aria-label="Close import modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                disabled={isReadingPdf}
                onClick={() => {
                  if (isReadingPdf) return;
                  setImportMode('text');
                  setImportError('');
                  setDetectedPdfRecipes([]);
                  setSelectedPdfRecipeIds([]);
                }}
                className={`rounded-2xl px-4 py-3 text-xs font-sans font-bold transition-all border ${
                  importMode === 'text'
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-primary border-surface-container-high hover:border-primary'
                } ${isReadingPdf ? 'opacity-50 cursor-not-allowed hover:border-surface-container-high' : ''}`}
              >
                Copy & Paste
              </button>
              <button
                type="button"
                disabled={isReadingPdf}
                onClick={() => {
                  if (isReadingPdf) return;
                  setImportMode('pdf');
                  setImportError('');
                  setDetectedPdfRecipes([]);
                  setSelectedPdfRecipeIds([]);
                }}
                className={`rounded-2xl px-4 py-3 text-xs font-sans font-bold transition-all border ${
                  importMode === 'pdf'
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-primary border-surface-container-high hover:border-primary'
                } ${isReadingPdf ? 'opacity-50 cursor-not-allowed hover:border-surface-container-high' : ''}`}
              >
                PDF
              </button>
              <button
                type="button"
                disabled={isReadingPdf}
                onClick={() => {
                  if (isReadingPdf) return;
                  setImportMode('image');
                  setImportError('');
                  setDetectedPdfRecipes([]);
                  setSelectedPdfRecipeIds([]);
                }}
                className={`rounded-2xl px-4 py-3 text-xs font-sans font-bold transition-all border ${
                  importMode === 'image'
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-primary border-surface-container-high hover:border-primary'
                } ${isReadingPdf ? 'opacity-50 cursor-not-allowed hover:border-surface-container-high' : ''}`}
              >
                Image
              </button>
              <button
                type="button"
                disabled={isReadingPdf}
                onClick={() => {
                  if (isReadingPdf) return;
                  setImportMode('camera');
                  setDetectedPdfRecipes([]);
                  setSelectedPdfRecipeIds([]);
                  setImportError('');
                }}
                className={`rounded-2xl px-4 py-3 text-xs font-sans font-bold transition-all border ${
                  importMode === 'camera'
                    ? 'bg-primary text-on-primary border-primary shadow-sm'
                    : 'bg-surface-container-low text-primary border-surface-container-high hover:border-primary'
                } ${isReadingPdf ? 'opacity-50 cursor-not-allowed hover:border-surface-container-high' : ''}`}
              >
                Camera
              </button>
            </div>

            {importMode === 'text' && (
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={`Example:\nChocolate Buns\nYield: 12 pcs\n\nIngredients\n500 g flour\n60 g sugar\n300 ml milk\n\nMethod\n1. Mix dry ingredients.\n2. Add milk and knead.\n3. Proof, shape, and bake.`}
                rows={14}
                className="w-full bg-white border border-surface-container-high rounded-xl p-4 text-sm font-sans text-on-surface resize-none focus:ring-1 focus:ring-primary"
              />
            )}

            {importMode === 'pdf' && (
              <div className="space-y-4">
                <label className={`block bg-white border-2 border-dashed border-outline-variant rounded-2xl p-5 text-center transition-colors ${
                  isReadingPdf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-primary'
                }`}
                onDragOver={e => {
                  if (isReadingPdf) e.preventDefault();
                }}
                onDrop={e => {
                  if (isReadingPdf) e.preventDefault();
                }}>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={isReadingPdf}
                    onChange={handlePdfFileChange}
                    className="hidden"
                  />
                  <FileText className="w-8 h-8 mx-auto text-outline mb-2" />
                  <span className="block font-sans font-bold text-sm text-primary">
                    {isReadingPdf ? 'Reading PDF...' : 'Choose PDF'}
                  </span>
                  <span className="block font-sans font-bold text-[11px] text-on-surface-variant mt-1">
                    Text-based PDFs work best. If text is detected, the editor will fill automatically.
                  </span>
                </label>
              </div>
            )}

            {importMode === 'image' && (
              <div className="space-y-4">
                <label className={`block bg-white border-2 border-dashed border-outline-variant rounded-2xl p-5 text-center transition-colors ${
                  isReadingPdf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-primary'
                }`}
                onDragOver={e => {
                  if (isReadingPdf) e.preventDefault();
                }}
                onDrop={e => {
                  if (isReadingPdf) e.preventDefault();
                }}>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isReadingPdf}
                    onChange={handleImageImportFileChange}
                    className="hidden"
                  />
                  <ImageIcon className="w-8 h-8 mx-auto text-outline mb-2" />
                  <span className="block font-sans font-bold text-sm text-primary">
                    {isReadingPdf ? 'Processing...' : 'Choose Image'}
                  </span>
                  <span className="block font-sans font-bold text-[11px] text-on-surface-variant mt-1">
                    Clear photos or screenshots with readable recipe text work best.
                  </span>
                </label>
              </div>
            )}

            {importMode === 'camera' && (
              <div className="space-y-4">
                <label className={`block bg-white border-2 border-dashed border-outline-variant rounded-2xl p-5 text-center transition-colors ${
                  isReadingPdf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-primary'
                }`}
                onDragOver={e => {
                  if (isReadingPdf) e.preventDefault();
                }}
                onDrop={e => {
                  if (isReadingPdf) e.preventDefault();
                }}>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={isReadingPdf}
                    onChange={handleScanRecipeFileChange}
                    className="hidden"
                  />
                  <Camera className="w-8 h-8 mx-auto text-outline mb-2" />
                  <span className="block font-sans font-bold text-sm text-primary">
                    {isReadingPdf ? 'Processing...' : 'Scan Recipe'}
                  </span>
                  <span className="block font-sans font-bold text-[11px] text-on-surface-variant mt-1">
                    Take a clear photo of a handwritten or printed recipe page. MiseChef will extract it for review.
                  </span>
                </label>
              </div>
            )}

            {isReadingPdf && aiImportStage && (importMode === 'image' || importMode === 'camera') && (
              <div
                key={aiImportStage}
                className="animate-fade-in bg-primary/10 border border-primary/20 rounded-2xl p-4 flex items-start gap-3 transition-opacity duration-300"
              >
                <span className="mt-1 h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin flex-shrink-0" />
                <div>
                  <p className="font-sans text-sm font-extrabold text-primary">
                    {AI_IMPORT_STAGES[aiImportStage].title}
                  </p>
                  <p className="font-sans text-xs font-bold text-on-surface-variant mt-1">
                    {AI_IMPORT_STAGES[aiImportStage].description}
                  </p>
                </div>
              </div>
            )}

            {detectedPdfRecipes.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-display text-lg font-bold text-primary">
                    Detected Recipes ({detectedPdfRecipes.length})
                  </h4>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPdfRecipeIds(
                        selectedPdfRecipeIds.length === detectedPdfRecipes.length
                          ? []
                          : detectedPdfRecipes.map(recipe => recipe.id)
                      )
                    }
                    className="text-xs font-sans font-bold text-secondary"
                  >
                    {selectedPdfRecipeIds.length === detectedPdfRecipes.length ? 'Clear All' : 'Select All'}
                  </button>
                </div>

                <div className="space-y-3">
                  {detectedPdfRecipes.map(recipe => {
                    const isSelected = selectedPdfRecipeIds.includes(recipe.id);
                    return (
                      <label
                        key={recipe.id}
                        className={`block rounded-2xl border p-4 cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-primary/10 border-primary'
                            : 'bg-white border-surface-container-high hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePdfRecipeSelection(recipe.id)}
                            className="mt-1 accent-primary"
                          />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div>
                              <h5 className="font-display text-base font-bold text-primary truncate">
                                {recipe.title}
                              </h5>
                              <p className="font-sans text-[11px] font-bold text-on-surface-variant">
                                {recipe.yield || 'Yield not found'} • {recipe.servings || 'Servings not found'} servings • {recipe.prepTime ? `${recipe.prepTime} min prep` : 'Prep not found'} • {recipe.cookTime ? `${recipe.cookTime} min cook` : 'Cook not found'} • {recipe.ingredients.length} ingredients • {recipe.method.length} steps
                              </p>
                              {recipe.chefNotes && (
                                <p className="font-sans text-[11px] font-semibold text-on-surface-variant mt-1">
                                  Notes: {recipe.chefNotes}
                                </p>
                              )}
                              {recipe.scannedImageDataUrl && (
                                <p className="font-sans text-[10px] font-extrabold text-secondary uppercase mt-1">
                                  Scan attachment ready
                                </p>
                              )}
                            </div>

                            {isSelected && (
                              <div className="grid md:grid-cols-2 gap-3 text-left">
                                <div className="bg-surface-container-low rounded-xl p-3">
                                  <p className="font-sans text-[10px] font-extrabold text-secondary uppercase mb-2">
                                    Ingredients Preview
                                  </p>
                                  <ul className="space-y-1">
                                    {recipe.ingredients.slice(0, 5).map(ingredient => (
                                      <li key={ingredient.id} className="font-sans text-xs font-semibold text-on-surface">
                                        {[ingredient.qty, ingredient.unit, ingredient.name].filter(Boolean).join(' ')}
                                        {ingredient.notes ? ` (${ingredient.notes})` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="bg-surface-container-low rounded-xl p-3">
                                  <p className="font-sans text-[10px] font-extrabold text-secondary uppercase mb-2">
                                    Method Preview
                                  </p>
                                  <ol className="space-y-1">
                                    {recipe.method.slice(0, 4).map(step => (
                                      <li key={step.id} className="font-sans text-xs font-semibold text-on-surface">
                                        {step.stepNumber}. {step.description}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {importError && (
              <div className="bg-secondary/10 border border-secondary/20 text-secondary rounded-xl p-3 font-sans text-xs font-bold">
                {importError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="bg-surface-container rounded-full px-5 py-3 text-xs font-sans font-bold text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportButtonClick}
                disabled={
                  isReadingPdf ||
                  (detectedPdfRecipes.length === 0 && (importMode !== 'text' || !importText.trim()))
                }
                className="bg-primary disabled:bg-outline-variant disabled:cursor-not-allowed text-on-primary rounded-full px-5 py-3 text-xs font-sans font-bold"
              >
                {isReadingPdf ? 'Processing...' : 'Import Recipe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
