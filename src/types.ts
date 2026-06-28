/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Ingredient {
  id: string;
  name: string;
  englishName?: string;
  chineseName?: string;
  qty: string;
  unit: string;
  notes?: string;
}

export interface MethodStep {
  id: string;
  stepNumber: number;
  image?: string;
  description: string;
}

export type RecipeVisibility =
  | "private"
  | "team"
  | "organization"
  | "public"
  | "marketplace";

export interface Recipe {
  id: string;
  title: string;
  coverImage: string;
  imageUrl?: string;
  scanAttachmentUrl?: string;
  scannedImageDataUrl?: string;
  category: string;
  categories?: string[];
  prepTime: number; // in minutes
  cookTime?: number;
  servings: number;
  yield: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  story: string;
  chefNotes?: string;
  ingredients: Ingredient[];
  method: MethodStep[];
  videoLink: string;
  chefName: string;
  chefAvatar?: string;
  isSaved: boolean;
  collections: string[]; // collection IDs
  createdAt?: string;
  tags?: string[];
  isFeatured?: boolean;
  visibility?: RecipeVisibility;
}

export interface RecipeCategory {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ChefProfile {
  photo: string;
  name: string;
  jobTitle: string;
  yearsExperience: string;
  bio: string;
  quote: string;
}

export const DEFAULT_CHEF_PROFILE: ChefProfile = {
  photo: '',
  name: 'Ce Lim',
  jobTitle: 'Junior Sous Chef',
  yearsExperience: '8+',
  bio: 'Passionate chef specializing in bakery, pastry, school meals, and recipe development.',
  quote: 'Every recipe tells a story.'
};

export type UserRole = 'admin' | 'user';

export interface KitchenDictionaryIngredient {
  chinese: string;
  english: string;
  category: string;
  aliases: string[];
}

export interface Collection {
  id: string;
  name: string;
  recipeCount: number;
  coverImage: string;
  description?: string;
}

export type RootTab = 'home' | 'search' | 'favorites' | 'statistics' | 'settings' | 'login';
