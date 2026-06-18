/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Ingredient {
  id: string;
  name: string;
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

export interface Recipe {
  id: string;
  title: string;
  coverImage: string;
  imageUrl?: string;
  category: string;
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
}

export interface RecipeCategory {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Collection {
  id: string;
  name: string;
  recipeCount: number;
  coverImage: string;
  description?: string;
}

export type RootTab = 'home' | 'search' | 'favorites' | 'statistics' | 'settings' | 'login';
