/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Check, Clock, Heart, Pencil, Play, Scale, Trash2, Users, X } from 'lucide-react';
import { Recipe } from '../types';
import { motion } from 'motion/react';

const normalizeUnit = (unit = '') => {
  const trimmed = unit.trim().toLowerCase();
  if (trimmed === 'l') return 'l';
  if (trimmed === 'litre' || trimmed === 'liter' || trimmed === 'litres' || trimmed === 'liters') return 'l';
  if (trimmed === 'piece' || trimmed === 'pieces' || trimmed === 'pc') return 'pcs';
  if (trimmed === 'serving') return 'servings';
  if (trimmed === 'loaves') return 'loaf';
  return trimmed;
};

const parseNumericText = (value: string) => {
  const clean = value.trim();
  if (!clean) return null;

  const mixedFraction = clean.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    return denominator ? whole + numerator / denominator : null;
  }

  const fraction = clean.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator ? numerator / denominator : null;
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseYield = (value: string) => {
  const match = value.trim().match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
  if (!match) return null;

  const amount = parseNumericText(match[1]);
  if (!amount || amount <= 0) return null;

  return {
    amount,
    unit: normalizeUnit(match[2] || '')
  };
};

const formatScaledQuantity = (value: number) => {
  if (Number.isInteger(value)) return String(value);

  const fixed = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
};

const scaleQuantity = (quantity: string, ratio: number) => {
  const amount = parseNumericText(quantity);
  if (amount === null) return quantity;
  return formatScaledQuantity(amount * ratio);
};

interface RecipeDetailModalProps {
  recipe: Recipe;
  onClose: () => void;
  onEdit: (recipe: Recipe) => void;
  onDelete: (recipe: Recipe) => void;
  onToggleFavorite: (recipeId: string) => void;
}

export default function RecipeDetailModal({
  recipe,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite
}: RecipeDetailModalProps) {
  const [checkedIngredients, setCheckedIngredients] = useState<string[]>([]);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showScaleControls, setShowScaleControls] = useState(false);
  const [targetYield, setTargetYield] = useState('');
  const [recipeView, setRecipeView] = useState<'original' | 'scaled'>('original');

  const originalYield = recipe.yield || `${recipe.servings} servings`;
  const originalParsedYield = parseYield(originalYield);
  const targetParsedYield = parseYield(targetYield);
  const canScale = Boolean(
    originalParsedYield &&
    targetParsedYield &&
    originalParsedYield.unit === targetParsedYield.unit
  );
  const scaleRatio = canScale && originalParsedYield && targetParsedYield
    ? targetParsedYield.amount / originalParsedYield.amount
    : 1;
  const isScaledView = recipeView === 'scaled' && canScale;

  useEffect(() => {
    if (!targetYield) {
      setRecipeView('original');
      return;
    }

    if (canScale) {
      setRecipeView('scaled');
    } else {
      setRecipeView('original');
    }
  }, [targetYield, canScale]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const toggleIngredientCheck = (ingId: string) => {
    setCheckedIngredients(prev =>
      prev.includes(ingId) ? prev.filter(id => id !== ingId) : [...prev, ingId]
    );
  };

  const toggleStepCompleted = (stepId: string) => {
    setCompletedSteps(prev =>
      prev.includes(stepId) ? prev.filter(id => id !== stepId) : [...prev, stepId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-end animate-fade-in backdrop-blur-xs">
      <div className="fixed inset-0" onClick={onClose} />

      <motion.div
        initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.95 }}
        animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1 }}
        exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', damping: 28, stiffness: 190 }}
        className="relative w-full max-w-[800px] bg-background h-full shadow-2xl flex flex-col z-10"
      >
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-50">
          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60 active:scale-95 transition-all outline-none"
            aria-label="Close recipe"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleFavorite(recipe.id)}
              className="p-2.5 rounded-full bg-white/95 text-secondary shadow-lg hover:scale-105 active:scale-95 transition-all outline-none"
              aria-label={recipe.isSaved ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart className={`w-4 h-4 ${recipe.isSaved ? 'fill-secondary text-secondary' : 'text-secondary'}`} />
            </button>
            <button
              onClick={() => onEdit(recipe)}
              className="px-4 py-2.5 rounded-full bg-white/95 text-primary shadow-lg hover:scale-105 active:scale-95 transition-all outline-none flex items-center gap-2 font-sans font-bold text-xs"
              aria-label="Edit recipe"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={() => onDelete(recipe)}
              className="px-4 py-2.5 rounded-full bg-white/95 text-error shadow-lg hover:scale-105 active:scale-95 transition-all outline-none flex items-center gap-2 font-sans font-bold text-xs"
              aria-label="Delete recipe"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-hide pb-12">
          <div className="relative w-full aspect-[16/10] sm:aspect-[21/9] bg-surface-container">
            <img
              src={recipe.coverImage}
              alt={recipe.title}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-black/20"></div>
          </div>

          <div className="px-5 sm:px-8 -mt-8 sm:-mt-12 relative z-20 space-y-8">
            <div className="bg-white border border-surface-container-high rounded-2xl p-6 shadow-sm shadow-primary/5 space-y-4">
              <span className="bg-secondary/10 border border-secondary/20 text-secondary px-3 py-1 text-xs rounded-full font-bold font-sans">
                {recipe.category.toUpperCase()}
              </span>

              <h2 className="font-display font-semibold text-2xl sm:text-3xl text-primary leading-tight">
                {recipe.title}
              </h2>

              <div className="flex flex-wrap items-center gap-3 border-t border-b border-surface-container/50 py-3 text-xs sm:text-sm text-on-surface-variant font-semibold">
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4 text-secondary" />
                  <span>{recipe.prepTime} mins prep</span>
                </div>
                <span className="text-outline-variant">•</span>
                <div className="flex items-center gap-1">
                  <Users className="w-4 h-4 text-primary" />
                  <span>{recipe.servings} Servings</span>
                </div>
                <span className="text-outline-variant">•</span>
                <span>Yield: {originalYield}</span>
                <span className="text-outline-variant">•</span>
                <span>{recipe.difficulty}</span>
              </div>

              {recipe.story && (
                <div className="bg-surface-container-low/60 p-4 rounded-xl border border-surface-container text-xs sm:text-sm text-on-surface-variant italic leading-relaxed font-semibold">
                  "{recipe.story}"
                </div>
              )}

              {recipe.chefNotes && (
                <div className="bg-surface-container-low/60 p-4 rounded-xl border border-surface-container text-xs sm:text-sm text-on-surface-variant leading-relaxed font-semibold">
                  <span className="block font-sans font-extrabold text-[10px] text-secondary uppercase tracking-wider mb-1">
                    Chef Notes
                  </span>
                  {recipe.chefNotes}
                </div>
              )}
            </div>

            <section className="bg-white border border-surface-container-high rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl font-bold text-primary">Recipe Yield</h3>
                  <p className="font-sans text-xs text-on-surface-variant font-bold">
                    Current Yield: {originalYield}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowScaleControls(prev => !prev)}
                  className="self-start sm:self-auto bg-primary text-on-primary rounded-full px-4 py-2.5 font-sans font-bold text-xs flex items-center gap-2 active:scale-95 transition-all"
                >
                  <Scale className="w-4 h-4" />
                  Scale Recipe
                </button>
              </div>

              {showScaleControls && (
                <div className="space-y-4 border-t border-surface-container pt-4">
                  <input
                    type="text"
                    value={targetYield}
                    onChange={e => setTargetYield(e.target.value)}
                    placeholder="Target yield, e.g. 80 pcs"
                    className="w-full bg-surface-container border-none rounded-xl font-sans text-sm text-on-surface px-4 py-3 focus:ring-1 focus:ring-primary font-bold"
                  />

                  {targetYield && !canScale && (
                    <p className="font-sans text-xs text-secondary font-bold">
                      Enter a target yield using the same unit as the original yield.
                    </p>
                  )}

                  {canScale && (
                    <div className="flex gap-2 bg-surface-container p-1 rounded-xl border border-surface-container-high w-full sm:w-fit">
                      <button
                        type="button"
                        onClick={() => setRecipeView('original')}
                        className={`px-4 py-2 rounded-lg text-xs font-sans font-bold transition-all ${
                          recipeView === 'original' ? 'bg-white text-primary shadow-sm' : 'text-outline hover:text-primary'
                        }`}
                      >
                        Original Recipe
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecipeView('scaled')}
                        className={`px-4 py-2 rounded-lg text-xs font-sans font-bold transition-all ${
                          recipeView === 'scaled' ? 'bg-white text-primary shadow-sm' : 'text-outline hover:text-primary'
                        }`}
                      >
                        Scaled Recipe
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex justify-between items-baseline border-b border-surface-container pb-2">
                <div>
                  <h3 className="font-display text-xl font-bold text-primary">Ingredients</h3>
                  {isScaledView && (
                    <p className="font-sans text-xs text-secondary font-bold mt-1">
                      Scaled to {targetYield}
                    </p>
                  )}
                </div>
                <span className="text-xs text-outline font-sans font-bold">
                  {checkedIngredients.length}/{recipe.ingredients.length} checked
                </span>
              </div>

              <ul className="divide-y divide-surface-container-high/50">
                {recipe.ingredients.map(ing => (
                  <li
                    key={ing.id}
                    onClick={() => toggleIngredientCheck(ing.id)}
                    className="flex justify-between items-center py-3 cursor-pointer group select-none font-sans"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                        checkedIngredients.includes(ing.id)
                          ? 'bg-primary border-primary text-white scale-102'
                          : 'border-outline-variant group-hover:border-primary bg-white'
                      }`}>
                        {checkedIngredients.includes(ing.id) && <Check className="w-3.5 h-3.5" />}
                      </div>
                      <span className={`text-sm font-semibold transition-all ${
                        checkedIngredients.includes(ing.id) ? 'line-through text-outline' : 'text-on-surface'
                      }`}>
                        {ing.name}
                        {ing.notes ? (
                          <span className="text-xs text-on-surface-variant font-medium"> ({ing.notes})</span>
                        ) : null}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-secondary font-sans block bg-secondary/5 px-2.5 py-0.5 rounded-md">
                      {isScaledView ? scaleQuantity(ing.qty, scaleRatio) : ing.qty} {ing.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-5">
              <h3 className="font-display text-xl font-bold text-primary border-b border-surface-container pb-2">
                Method
              </h3>

              <div className="space-y-4">
                {recipe.method.map((step, idx) => {
                  const isDone = completedSteps.includes(step.id);
                  return (
                    <div
                      key={step.id}
                      onClick={() => toggleStepCompleted(step.id)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer select-none space-y-3 ${
                        isDone
                          ? 'bg-surface-container/40 border-surface-container text-outline'
                          : 'bg-white border-surface-container-high hover:border-primary/45 text-on-surface shadow-xs shadow-primary/2'
                      }`}
                    >
                      <div className="flex justify-between items-center pb-2 border-b border-surface-container/30">
                        <span className={`font-sans font-extrabold text-xs tracking-wider ${isDone ? 'text-outline/80' : 'text-secondary'}`}>
                          STEP {idx + 1}
                        </span>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                          isDone ? 'bg-primary text-white scale-102' : 'border border-outline-variant bg-white text-transparent'
                        }`}>
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      </div>

                      <div className="flex gap-4 flex-col sm:flex-row items-stretch">
                        {step.image && (
                          <div className="shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-surface-container border">
                            <img
                              src={step.image}
                              alt={`Step ${idx + 1}`}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                        <p className={`text-sm leading-relaxed font-semibold flex-1 ${
                          isDone ? 'line-through opacity-70 font-normal text-outline' : 'text-on-surface-variant'
                        }`}>
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {recipe.videoLink && (
              <section className="bg-secondary/5 border border-secondary/15 p-5 rounded-2xl flex flex-col md:flex-row gap-6 justify-between items-center text-sm font-sans font-bold">
                <div>
                  <span className="block text-[10px] text-outline uppercase tracking-wider">Video Link</span>
                  <span className="text-primary font-sans font-extrabold text-sm">Optional recipe walkthrough</span>
                </div>
                <a
                  href={recipe.videoLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-white bg-secondary hover:bg-secondary-container px-6 py-2.5 rounded-full text-xs shadow-md shadow-secondary/15 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  Open Video
                </a>
              </section>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
