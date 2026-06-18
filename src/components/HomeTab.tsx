/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Heart, Play, Search } from 'lucide-react';
import type { User } from 'firebase/auth';
import { Recipe } from '../types';

interface ChefProfile {
  photo: string;
  name: string;
  jobTitle: string;
  yearsExperience: string;
  bio: string;
  quote: string;
}

interface HomeTabProps {
  recipes: Recipe[];
  selectedCategory?: string | null;
  isFavoritesFilter?: boolean;
  onSelectRecipe: (recipe: Recipe) => void;
  onToggleFavorite: (recipeId: string) => void;
  currentUser?: User | null;
  customAvatarUrl?: string;
}

const CHEF_PROFILE_STORAGE_KEY = 'ce_lims_kitchen_chef_profile_v1';

const DEFAULT_CHEF_PROFILE: ChefProfile = {
  photo: '',
  name: 'Ce Lim',
  jobTitle: 'Junior Sous Chef',
  yearsExperience: '8+',
  bio: 'Passionate chef specializing in bakery, pastry, school meals, and recipe development.',
  quote: 'Every recipe tells a story.'
};

export default function HomeTab({
  recipes,
  selectedCategory = null,
  isFavoritesFilter = false,
  onSelectRecipe,
  onToggleFavorite,
  currentUser = null,
  customAvatarUrl = ''
}: HomeTabProps) {
  // All recipes in the database are user-owned now
  const chefRecipes = recipes;
  const activeFilterLabel = isFavoritesFilter ? 'Favorites' : selectedCategory;
  const [profile, setProfile] = useState<ChefProfile>(DEFAULT_CHEF_PROFILE);
  const [searchQuery, setSearchQuery] = useState('');
  const authDisplayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || '';
  const profileAvatarUrl = customAvatarUrl || profile.photo || currentUser?.photoURL || '';
  const profileInitials = (profile.name || authDisplayName || 'CL')
    .split(' ')
    .map(part => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'CL';

  const searchedRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return chefRecipes;

    return chefRecipes.filter(recipe => {
      const ingredientText = recipe.ingredients
        .map(ingredient => `${ingredient.qty} ${ingredient.unit} ${ingredient.name}`)
        .join(' ');
      const tagText = recipe.tags?.join(' ') || '';
      const searchableText = [
        recipe.title,
        recipe.category,
        ingredientText,
        tagText
      ].join(' ').toLowerCase();

      return searchableText.includes(query);
    });
  }, [chefRecipes, searchQuery]);

  useEffect(() => {
    const cachedProfile = localStorage.getItem(CHEF_PROFILE_STORAGE_KEY);
    if (!cachedProfile) {
      setProfile(DEFAULT_CHEF_PROFILE);
      return;
    }

    try {
      const parsedProfile = {
        ...DEFAULT_CHEF_PROFILE,
        ...JSON.parse(cachedProfile)
      };
      setProfile(parsedProfile);
    } catch (err) {
      setProfile(DEFAULT_CHEF_PROFILE);
    }
  }, []);

  return (
    <div className="space-y-10 animate-fade-in">
      <section className="bg-surface-container-low border border-surface-container-high p-5 sm:p-6 rounded-2xl shadow-sm">
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-6">
          <div className="flex flex-col items-center sm:items-start gap-3 shrink-0">
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-primary/10 border border-surface-container-high flex items-center justify-center text-primary">
              {profileAvatarUrl ? (
                <img
                  src={profileAvatarUrl}
                  alt={profile.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-display text-3xl font-bold">{profileInitials}</span>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1 text-center sm:text-left">
                <span className="font-sans font-bold text-xs tracking-widest text-secondary bg-secondary/10 px-3 py-1 rounded-full uppercase">
                  Chef Profile
                </span>
                <h2 className="font-display font-bold text-3xl sm:text-4xl text-primary tracking-tight pt-2">
                  {profile.name}
                </h2>
                <p className="font-sans text-sm text-secondary font-extrabold">
                  {profile.jobTitle} • {profile.yearsExperience} years experience
                </p>
              </div>
            </div>

            <div className="space-y-3 text-center sm:text-left">
              <p className="font-sans text-sm text-on-surface-variant leading-relaxed font-semibold max-w-3xl">
                {profile.bio}
              </p>
              <blockquote className="font-display italic text-lg text-primary">
                "{profile.quote}"
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      {/* User Culinary Journal Dashboard Header Section */}
      <section className="bg-surface-container-low border border-surface-container-high p-6 rounded-2xl flex flex-col md:flex-row gap-6 items-center justify-between shadow-sm">
        <div className="space-y-2 text-center md:text-left">
          <span className="font-sans font-bold text-xs tracking-widest text-secondary bg-secondary/10 px-3 py-1 rounded-full uppercase">
            {activeFilterLabel ? 'Filtered Library' : 'Culinary Journal'}
          </span>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-primary tracking-tight">
            {activeFilterLabel || 'My Recipes'}
          </h2>
          <p className="font-sans text-sm text-on-surface-variant max-w-2xl leading-relaxed font-semibold">
            {activeFilterLabel
              ? `Showing recipes in ${activeFilterLabel}.`
              : 'Record, organize, and cherish your home-cooked meals and family recipes. Complete with ingredients lists, step-by-step methods, and a digital archive.'}
          </p>
        </div>

        {/* Real-time stats based on actual data */}
        <div className="grid grid-cols-1 gap-3 min-w-[180px] w-full md:w-auto">
          <div className="bg-white border border-surface-container p-4 rounded-xl flex flex-col items-center justify-center text-center shadow-sm">
            <span className="font-display text-primary font-bold text-2xl">{recipes.length}</span>
            <span className="font-sans font-bold text-[9px] text-on-surface-variant/80 uppercase tracking-widest mt-1">Total Recipes</span>
          </div>
        </div>
      </section>

      {/* Recipes Grid Section */}
      <section className="space-y-4">
        <div className="space-y-4">
          <div className="flex justify-between items-baseline">
            <h3 className="font-display text-2xl font-bold text-primary tracking-tight">My Kitchen</h3>
            {chefRecipes.length > 0 && (
              <span className="text-secondary font-sans font-bold text-sm">
                {activeFilterLabel
                  ? `${activeFilterLabel} (${searchedRecipes.length}/${chefRecipes.length})`
                  : `Primary Library (${searchedRecipes.length}/${chefRecipes.length})`}
              </span>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search recipes, ingredients, categories, or tags..."
              className="w-full bg-white border border-surface-container-high rounded-2xl pl-11 pr-4 py-3.5 text-sm font-sans font-bold text-on-surface placeholder:text-outline-variant focus:ring-1 focus:ring-primary outline-none transition-all"
              aria-label="Search recipes"
            />
          </div>
        </div>

        {chefRecipes.length === 0 ? (
          <div className="bg-surface-container-low border border-dashed border-outline-variant rounded-2xl py-16 px-4 text-center max-w-2xl mx-auto flex flex-col items-center justify-center space-y-4 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-3xl">
              📖
            </div>
            <div className="space-y-1.5">
              <h4 className="font-display font-bold text-lg text-primary">
                {isFavoritesFilter ? 'No favorite recipes yet' : 'Your cookbook is empty'}
              </h4>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant/90 max-w-md mx-auto leading-relaxed font-semibold">
                {isFavoritesFilter
                  ? 'Recipes you mark as favorites will appear here for quick access.'
                  : <>Start building your personalized digital cookbook! Tap the green <span className="font-bold text-primary">"+"</span> button in the bottom right corner to add your very first custom recipe.</>}
              </p>
            </div>
          </div>
        ) : searchedRecipes.length === 0 ? (
          <div className="bg-surface-container-low border border-dashed border-outline-variant rounded-2xl py-16 px-4 text-center max-w-2xl mx-auto flex flex-col items-center justify-center space-y-4 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Search className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h4 className="font-display font-bold text-lg text-primary">No recipes found.</h4>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant/90 max-w-md mx-auto leading-relaxed font-semibold">
                Try searching by recipe title, ingredient, category, or tag.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {searchedRecipes.map(recipe => (
              <div
                key={recipe.id}
                onClick={() => onSelectRecipe(recipe)}
                className="group relative bg-surface-container rounded-2xl overflow-hidden cursor-pointer shadow-sm hover:shadow-lg transition-all duration-300 border border-surface-container-high"
              >
                <div className="aspect-[4/3] overflow-hidden relative">
                  <img
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    src={recipe.coverImage}
                    alt={recipe.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  
                  {/* Visual marker if it has a video walkthrough */}
                  {recipe.videoLink && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/15 group-hover:bg-black/25 transition-colors">
                      <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center text-secondary shadow-md group-hover:scale-110 duration-300 transition-transform">
                        <Play className="w-5 h-5 fill-secondary ml-0.5" />
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      onToggleFavorite(recipe.id);
                    }}
                    className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/85 backdrop-blur-sm shadow-sm flex items-center justify-center text-secondary active:scale-90 hover:scale-105 transition-all outline-none"
                    aria-label={recipe.isSaved ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Heart className={`w-4 h-4 ${recipe.isSaved ? 'fill-secondary text-secondary' : 'text-secondary'}`} />
                  </button>
                </div>
                <div className="p-4 bg-surface-container-lowest flex flex-col justify-between min-h-[90px]">
                  <div>
                    <h4 className="font-display text-lg font-bold text-primary tracking-tight leading-snug group-hover:text-secondary transition-colors">
                      {recipe.title}
                    </h4>
                    <div className="flex items-center gap-2 mt-2 text-xs text-on-surface-variant font-semibold">
                      <span>{recipe.prepTime} mins</span>
                      <span className="text-outline-variant">•</span>
                      <span>{recipe.category}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
