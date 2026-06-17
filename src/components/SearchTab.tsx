/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Check, Clock, Heart, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Recipe, RecipeCategory } from '../types';

const FALLBACK_CATEGORY_NAME = 'Others';

interface SearchTabProps {
  recipes: Recipe[];
  categories: RecipeCategory[];
  onSelectRecipe: (recipe: Recipe) => void;
  onCreateCategory: (name: string) => RecipeCategory | null;
  onRenameCategory: (categoryId: string, nextName: string) => void;
  onDeleteCategory: (categoryId: string, targetCategoryName: string) => void;
  onToggleFavorite: (recipeId: string) => void;
}

export default function SearchTab({
  recipes,
  categories,
  onSelectRecipe,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onToggleFavorite
}: SearchTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<RecipeCategory | null>(null);
  const [moveTargetCategory, setMoveTargetCategory] = useState(FALLBACK_CATEGORY_NAME);

  const categoryCounts = useMemo(() => {
    return categories.reduce<Record<string, number>>((acc, category) => {
      acc[category.name] = recipes.filter(recipe => recipe.category === category.name).length;
      return acc;
    }, {});
  }, [categories, recipes]);

  const filteredRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return recipes.filter(recipe => {
      const matchesQuery =
        !query ||
        recipe.title.toLowerCase().includes(query) ||
        recipe.category.toLowerCase().includes(query) ||
        recipe.story.toLowerCase().includes(query) ||
        recipe.ingredients.some(ingredient => ingredient.name.toLowerCase().includes(query));

      const matchesCategory = !selectedCategory || recipe.category === selectedCategory;

      return matchesQuery && matchesCategory;
    });
  }, [recipes, searchQuery, selectedCategory]);

  const handleCreateCategory = () => {
    const createdCategory = onCreateCategory(newCategoryName);
    if (createdCategory) {
      setNewCategoryName('');
      setSelectedCategory(createdCategory.name);
    }
  };

  const startRenameCategory = (category: RecipeCategory) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  };

  const saveRenameCategory = () => {
    if (!editingCategoryId) return;
    const category = categories.find(item => item.id === editingCategoryId);
    const nextName = editingCategoryName.trim();
    onRenameCategory(editingCategoryId, editingCategoryName);
    if (category && nextName && selectedCategory === category.name) {
      setSelectedCategory(nextName);
    }
    setEditingCategoryId(null);
    setEditingCategoryName('');
  };

  const startDeleteCategory = (category: RecipeCategory) => {
    setDeletingCategory(category);
    const firstAlternative = categories.find(item => item.id !== category.id)?.name || FALLBACK_CATEGORY_NAME;
    setMoveTargetCategory(firstAlternative);
  };

  const confirmDeleteCategory = (targetCategoryName: string) => {
    if (!deletingCategory) return;
    onDeleteCategory(deletingCategory.id, targetCategoryName);
    if (selectedCategory === deletingCategory.name) {
      setSelectedCategory(targetCategoryName);
    }
    setDeletingCategory(null);
  };

  const deletingCategoryCount = deletingCategory ? categoryCounts[deletingCategory.name] || 0 : 0;
  const movableCategories = deletingCategory
    ? categories.filter(category => category.id !== deletingCategory.id)
    : categories;

  return (
    <div className="space-y-8 animate-fade-in relative pb-10">
      <section className="relative">
        <div className="relative flex items-center bg-surface-container-low hover:bg-surface-container rounded-2xl shadow-sm border border-surface-container-high transition-all p-1">
          <Search className="w-5 h-5 ml-4 text-outline" />
          <input
            type="text"
            placeholder="Search your recipes or ingredients..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-none py-3.5 pl-3 pr-4 text-sm focus:ring-0 text-on-surface placeholder:text-outline/65 font-sans font-medium"
          />
        </div>
      </section>

      <section className="bg-surface-container-low border border-surface-container-high rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-primary">Categories</h2>
            <p className="font-sans text-xs text-on-surface-variant font-bold">
              Organize your personal recipe library.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="New category"
              className="min-w-0 flex-1 sm:w-52 bg-white border border-surface-container-high rounded-xl px-4 py-2.5 text-xs font-sans font-bold"
            />
            <button
              type="button"
              onClick={handleCreateCategory}
              className="bg-primary text-on-primary rounded-xl px-4 py-2.5 font-sans font-bold text-xs flex items-center gap-2 active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-full text-xs font-sans font-bold transition-all ${
              !selectedCategory ? 'bg-primary text-on-primary' : 'bg-white text-primary border border-surface-container-high'
            }`}
          >
            All ({recipes.length})
          </button>

          {categories.map(category => {
            const isSelected = selectedCategory === category.name;
            const isEditing = editingCategoryId === category.id;
            const isFallback = category.name === FALLBACK_CATEGORY_NAME;

            return (
              <div
                key={category.id}
                className={`flex items-center gap-1 rounded-full border transition-all ${
                  isSelected ? 'bg-primary text-on-primary border-primary' : 'bg-white text-primary border-surface-container-high'
                }`}
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={editingCategoryName}
                    onChange={e => setEditingCategoryName(e.target.value)}
                    className="w-36 bg-transparent px-3 py-2 text-xs font-sans font-bold outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(isSelected ? null : category.name)}
                    className="pl-4 pr-2 py-2 text-xs font-sans font-bold"
                  >
                    {category.name} ({categoryCounts[category.name] || 0})
                  </button>
                )}

                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveRenameCategory}
                      className="p-1.5 rounded-full hover:bg-primary/10"
                      aria-label="Save category name"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCategoryId(null)}
                      className="p-1.5 mr-1 rounded-full hover:bg-primary/10"
                      aria-label="Cancel category rename"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    {!isFallback && (
                      <button
                        type="button"
                        onClick={() => startRenameCategory(category)}
                        className="p-1.5 rounded-full hover:bg-primary/10"
                        aria-label={`Rename ${category.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!isFallback && (
                      <button
                        type="button"
                        onClick={() => startDeleteCategory(category)}
                        className="p-1.5 mr-1 rounded-full hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${category.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex justify-between items-baseline">
          <h2 className="font-display text-xl font-bold text-primary">
            Recipes ({filteredRecipes.length})
          </h2>
        </div>

        {filteredRecipes.length === 0 ? (
          <div className="bg-surface-container-low border border-dashed border-outline-variant rounded-2xl py-12 text-center text-on-surface-variant flex flex-col items-center justify-center space-y-3 px-4">
            <span className="text-4xl">📖</span>
            <p className="font-display text-lg font-bold text-primary">No recipes found</p>
            <p className="text-xs max-w-xs font-semibold leading-relaxed">
              Try a different recipe name, ingredient, or category.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRecipes.map(recipe => (
              <div
                key={recipe.id}
                onClick={() => onSelectRecipe(recipe)}
                className="bg-surface-container-low border border-surface-container-high rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer group relative"
              >
                <div className="relative">
                  <img
                    className="w-full h-44 object-cover"
                    src={recipe.coverImage}
                    alt={recipe.title}
                    referrerPolicy="no-referrer"
                  />
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      onToggleFavorite(recipe.id);
                    }}
                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm shadow-sm flex items-center justify-center text-secondary active:scale-90 hover:scale-105 transition-all outline-none"
                    aria-label={recipe.isSaved ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Heart className={`w-4 h-4 ${recipe.isSaved ? 'fill-secondary text-secondary' : 'text-secondary'}`} />
                  </button>
                </div>
                <div className="p-4 space-y-2">
                  <span className="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-sans text-[10px] font-bold">
                    {recipe.category}
                  </span>
                  <h3 className="font-display font-semibold text-base text-primary leading-snug group-hover:text-secondary duration-300 transition-colors line-clamp-1">
                    {recipe.title}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-outline font-semibold">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{recipe.prepTime} mins</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {deletingCategory && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border border-surface-container-high rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5">
            <div className="space-y-2">
              <h3 className="font-display text-xl font-bold text-primary">
                Delete "{deletingCategory.name}"?
              </h3>
              <p className="font-sans text-sm text-on-surface-variant font-semibold">
                {deletingCategoryCount} recipes currently use this category.
              </p>
              <p className="font-sans text-xs text-on-surface-variant font-semibold">
                Recipes will be moved to another category. No recipes will be deleted.
              </p>
            </div>

            <div className="space-y-2">
              <label className="font-sans font-bold text-xs text-on-surface-variant">
                Move recipes to another category
              </label>
              <select
                value={moveTargetCategory}
                onChange={e => setMoveTargetCategory(e.target.value)}
                className="w-full bg-surface-container border-none rounded-xl px-4 py-3 text-sm font-sans font-bold"
              >
                {movableCategories.map(category => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setDeletingCategory(null)}
                className="flex-1 bg-surface-container rounded-full py-3 text-xs font-sans font-bold text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteCategory(FALLBACK_CATEGORY_NAME)}
                className="flex-1 bg-secondary/10 text-secondary rounded-full py-3 text-xs font-sans font-bold"
              >
                Move to Others
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteCategory(moveTargetCategory)}
                className="flex-1 bg-primary text-on-primary rounded-full py-3 text-xs font-sans font-bold"
              >
                Move & Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
