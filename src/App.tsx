/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, Plus, Home } from 'lucide-react';
import { getRedirectResult, onAuthStateChanged, signOut, type Unsubscribe, type User } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { ChefProfile, DEFAULT_CHEF_PROFILE, Recipe, RecipeCategory, RootTab, UserRole } from './types';
import { INITIAL_COLLECTIONS, INITIAL_RECIPES } from './data';
import Header from './components/Header';
import HomeTab from './components/HomeTab';
import SearchTab from './components/SearchTab';
import AddRecipeTab from './components/AddRecipeTab';
import RecipeDetailModal from './components/RecipeDetailModal';
import NavigationDrawer from './components/NavigationDrawer';
import SettingsTab, { ImportedAppData } from './components/SettingsTab';
import LoginTab from './components/LoginTab';
import FavoritesTab from './components/FavoritesTab';
import StatisticsTab from './components/StatisticsTab';
import { AnimatePresence, motion } from 'motion/react';
import BrandLogo from './components/BrandLogo';
import { auth, authPersistenceReady, db } from './firebase';
import { deleteRecipeCoverImage, deleteRecipeScanAttachment, isLocalImageDataUrl, uploadRecipeCoverImage, uploadRecipeScanAttachment } from './services/storage';
import { FALLBACK_CATEGORY_NAME, getRecipeCategories, normalizeRecipeCategories, recipeHasCategory } from './utils/categoryUtils';
import { normalizeIngredientForDisplay } from './utils/ingredientParser';
import { getConfiguredRoleForUser, resolveUserRole } from './utils/userRoles';

const STORAGE_RECIPES_KEY = 'my_cookbook_recipes_v2';
const STORAGE_CATEGORIES_KEY = 'ce_lims_kitchen_categories_v1';
const STORAGE_APPEARANCE_KEY = 'ce_lims_kitchen_appearance_v1';
const STORAGE_PROFILE_KEY = 'ce_lims_kitchen_chef_profile_v1';
const DEFAULT_COVER_IMAGE = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&q=80&w=800';

function BrandLoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex flex-col items-center gap-4 text-center"
      >
        <BrandLogo className="h-8 w-auto" />
        <div className="space-y-1">
          <h1 className="font-display italic text-4xl text-primary font-semibold">
            MiseChef
          </h1>
          <p className="font-sans text-xs text-secondary font-bold tracking-wide">
            Everything in its place.
          </p>
          <p className="font-sans text-[9px] text-outline font-extrabold uppercase tracking-[0.22em]">
            by Ce Lim
          </p>
        </div>
      </motion.div>
    </div>
  );
}

const createCategoryRecord = (name: string): RecipeCategory => ({
  id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: name.trim(),
  createdAt: new Date().toISOString()
});

const buildInitialCategories = (recipeList: Recipe[]) => {
  const names = new Set<string>();
  recipeList.forEach(recipe => {
    const categories = Array.isArray(recipe.categories) && recipe.categories.length > 0
      ? recipe.categories
      : [recipe.category];
    normalizeRecipeCategories(categories).forEach(category => {
      if (category !== FALLBACK_CATEGORY_NAME) {
        names.add(category);
      }
    });
  });

  return Array.from(names).map(name => createCategoryRecord(name));
};

const sanitizeCategoryList = (categoryList: RecipeCategory[]) => {
  const seen = new Set<string>();

  return categoryList
    .map(category => ({ ...category, name: category.name.trim() }))
    .filter(category => category.name && category.name !== FALLBACK_CATEGORY_NAME)
    .filter(category => {
      const key = category.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const loadLocalRecipes = () => {
  const cachedRecipes = localStorage.getItem(STORAGE_RECIPES_KEY);

  if (!cachedRecipes) return INITIAL_RECIPES.map(normalizeLoadedRecipe);

  try {
    const parsedRecipes = JSON.parse(cachedRecipes);
    return Array.isArray(parsedRecipes)
      ? (parsedRecipes as Recipe[]).map(normalizeLoadedRecipe)
      : INITIAL_RECIPES.map(normalizeLoadedRecipe);
  } catch (err) {
    return INITIAL_RECIPES.map(normalizeLoadedRecipe);
  }
};

const normalizeChefProfile = (profile?: Partial<ChefProfile> | null): ChefProfile => ({
  ...DEFAULT_CHEF_PROFILE,
  ...(profile || {}),
  photo: typeof profile?.photo === 'string' ? profile.photo : DEFAULT_CHEF_PROFILE.photo,
  name: typeof profile?.name === 'string' ? profile.name : DEFAULT_CHEF_PROFILE.name,
  jobTitle: typeof profile?.jobTitle === 'string' ? profile.jobTitle : DEFAULT_CHEF_PROFILE.jobTitle,
  yearsExperience: typeof profile?.yearsExperience === 'string' ? profile.yearsExperience : DEFAULT_CHEF_PROFILE.yearsExperience,
  bio: typeof profile?.bio === 'string' ? profile.bio : DEFAULT_CHEF_PROFILE.bio,
  quote: typeof profile?.quote === 'string' ? profile.quote : DEFAULT_CHEF_PROFILE.quote
});

const loadLocalProfile = () => {
  const cachedProfile = localStorage.getItem(STORAGE_PROFILE_KEY);
  if (!cachedProfile) return DEFAULT_CHEF_PROFILE;

  try {
    const parsedProfile = JSON.parse(cachedProfile);
    return normalizeChefProfile(parsedProfile);
  } catch (err) {
    return DEFAULT_CHEF_PROFILE;
  }
};

const removeUndefinedFields = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => removeUndefinedFields(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, item]) => {
      if (item !== undefined) {
        acc[key] = removeUndefinedFields(item);
      }
      return acc;
    }, {}) as T;
  }

  return value;
};

const getFirestoreRecipePayload = (recipe: Recipe, user: User) => {
  const imageUrl = recipe.imageUrl || recipe.coverImage || DEFAULT_COVER_IMAGE;
  const { scannedImageDataUrl, ...recipeForFirestore } = recipe;
  const categories = normalizeRecipeCategories(
    Array.isArray(recipe.categories) ? recipe.categories : [recipe.category]
  );

  return removeUndefinedFields({
    ...recipeForFirestore,
    category: categories[0] || '',
    categories,
    coverImage: imageUrl,
    imageUrl,
    userId: user.uid,
    updatedAt: new Date().toISOString()
  });
};

const normalizeLoadedRecipe = (recipe: Recipe) => {
  const categories = getRecipeCategories(recipe);
  const imageUrl = recipe.imageUrl || recipe.coverImage || DEFAULT_COVER_IMAGE;

  return {
    ...recipe,
    category: categories[0] === FALLBACK_CATEGORY_NAME ? '' : categories[0],
    categories: categories[0] === FALLBACK_CATEGORY_NAME ? [] : categories,
    ingredients: Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map(normalizeIngredientForDisplay)
      : [],
    coverImage: imageUrl,
    imageUrl
  } as Recipe;
};

const createUserDocument = async (user: User): Promise<UserRole> => {
  if (!db) return getConfiguredRoleForUser(user);

  const userRef = doc(db, 'users', user.uid);
  const existingUser = await getDoc(userRef);
  const existingUserData = existingUser.exists() ? existingUser.data() : null;
  const role = resolveUserRole(user, existingUserData?.role);
  const existingProfile = existingUser.exists()
    ? normalizeChefProfile(existingUserData?.profile as Partial<ChefProfile> | undefined)
    : normalizeChefProfile({
        name: user.displayName || DEFAULT_CHEF_PROFILE.name,
        photo: user.photoURL || DEFAULT_CHEF_PROFILE.photo
      });

  await setDoc(userRef, removeUndefinedFields({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    role,
    profile: existingProfile,
    authProvider: user.providerData[0]?.providerId || 'password',
    createdAt: existingUser.exists() ? existingUserData?.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }), { merge: true });

  return role;
};

const loadFirestoreProfile = async (user: User) => {
  if (!db) return null;

  const userSnapshot = await getDoc(doc(db, 'users', user.uid));
  if (!userSnapshot.exists()) return null;

  return normalizeChefProfile(userSnapshot.data().profile as Partial<ChefProfile> | undefined);
};

const loadFirestoreRecipes = async (user: User) => {
  if (!db) return [];

  const recipesQuery = query(collection(db, 'recipes'), where('userId', '==', user.uid));
  const snapshot = await getDocs(recipesQuery);

  return snapshot.docs
    .map(recipeDoc => {
      const data = recipeDoc.data() as Recipe;
      return normalizeLoadedRecipe({
        id: recipeDoc.id,
        ...data
      } as Recipe);
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
};

const loadFirestoreCategories = async (user: User) => {
  if (!db) return [];

  const categoriesQuery = query(collection(db, 'categories'), where('userId', '==', user.uid));
  const snapshot = await getDocs(categoriesQuery);
  const loadedCategories = snapshot.docs
    .map(categoryDoc => ({ id: categoryDoc.id, ...categoryDoc.data() } as RecipeCategory))
    .filter(category => category.name?.trim())
    .sort((a, b) => a.name.localeCompare(b.name));

  return sanitizeCategoryList(loadedCategories);
};

const saveCategoryToFirestore = async (category: RecipeCategory, user: User) => {
  if (!db) return;

  await setDoc(doc(db, 'categories', category.id), removeUndefinedFields({
    ...category,
    name: category.name.trim(),
    userId: user.uid,
    updatedAt: new Date().toISOString()
  }), { merge: true });
};

const deleteCategoryFromFirestore = async (categoryId: string) => {
  if (!db) return;

  await deleteDoc(doc(db, 'categories', categoryId));
};

const saveRecipeToFirestore = async (recipe: Recipe, user: User) => {
  if (!db) {
    return;
  }

  await setDoc(doc(db, 'recipes', recipe.id), getFirestoreRecipePayload(recipe, user), { merge: true });
};

const deleteRecipeFromFirestore = async (recipeId: string) => {
  if (!db) {
    return;
  }

  await deleteDoc(doc(db, 'recipes', recipeId));
};

const getCloudReadyRecipe = async (
  recipe: Recipe,
  user: User,
  onUploadProgress?: (progress: number, phase: 'cover' | 'scan') => void
) => {
  let nextRecipe = { ...recipe };

  if (isLocalImageDataUrl(recipe.coverImage)) {
    const imageUrl = await uploadRecipeCoverImage({
      userId: user.uid,
      recipeId: recipe.id,
      imageDataUrl: recipe.coverImage,
      onProgress: progress => onUploadProgress?.(progress, 'cover'),
    });

    nextRecipe = {
      ...nextRecipe,
      coverImage: imageUrl,
      imageUrl,
    };
  }

  if (isLocalImageDataUrl(recipe.scannedImageDataUrl)) {
    const scanAttachmentUrl = await uploadRecipeScanAttachment({
      userId: user.uid,
      recipeId: recipe.id,
      imageDataUrl: recipe.scannedImageDataUrl,
      onProgress: progress => onUploadProgress?.(progress, 'scan'),
    });

    nextRecipe = {
      ...nextRecipe,
      scanAttachmentUrl,
    };
  }

  const imageUrl = nextRecipe.imageUrl || nextRecipe.coverImage || DEFAULT_COVER_IMAGE;
  return {
    ...nextRecipe,
    coverImage: imageUrl,
    imageUrl,
    scannedImageDataUrl: undefined,
  };
};

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [collections] = useState(INITIAL_COLLECTIONS);
  const [categories, setCategories] = useState<RecipeCategory[]>([]);
  const [activeTab, setActiveTab] = useState<RootTab>('login');
  const [addingRecipe, setAddingRecipe] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [isNavigationDrawerOpen, setIsNavigationDrawerOpen] = useState(false);
  const [selectedHomeCategory, setSelectedHomeCategory] = useState<string | null>(null);
  const [isFavoritesFilterActive, setIsFavoritesFilterActive] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>('user');
  const [chefProfile, setChefProfile] = useState<ChefProfile>(DEFAULT_CHEF_PROFILE);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  
  // Notification states
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Load from local storage
  useEffect(() => {
    const cachedAppearance = localStorage.getItem(STORAGE_APPEARANCE_KEY);
    document.documentElement.dataset.appearance =
      cachedAppearance === 'light' || cachedAppearance === 'dark' || cachedAppearance === 'system'
        ? cachedAppearance
        : 'system';

    const cachedRecipes = localStorage.getItem(STORAGE_RECIPES_KEY);
    const cachedCategories = localStorage.getItem(STORAGE_CATEGORIES_KEY);
    const localProfile = loadLocalProfile();
    setChefProfile(localProfile);
    setCustomAvatarUrl(localProfile.photo);
    let loadedRecipes = INITIAL_RECIPES;

    if (cachedRecipes) {
      try {
        loadedRecipes = (JSON.parse(cachedRecipes) as Recipe[]).map(normalizeLoadedRecipe);
        setRecipes(loadedRecipes);
      } catch (err) {
        const normalizedInitialRecipes = INITIAL_RECIPES.map(normalizeLoadedRecipe);
        loadedRecipes = normalizedInitialRecipes;
        setRecipes(normalizedInitialRecipes);
      }
    } else {
      const normalizedInitialRecipes = INITIAL_RECIPES.map(normalizeLoadedRecipe);
      loadedRecipes = normalizedInitialRecipes;
      setRecipes(normalizedInitialRecipes);
      localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(normalizedInitialRecipes));
    }

    if (cachedCategories) {
      try {
        const parsedCategories = JSON.parse(cachedCategories);
        const nextCategories = sanitizeCategoryList(parsedCategories);
        setCategories(nextCategories);
        localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(nextCategories));
      } catch (err) {
        const initialCategories: RecipeCategory[] = [];
        setCategories(initialCategories);
        localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(initialCategories));
      }
    } else {
      const initialCategories: RecipeCategory[] = [];
      setCategories(initialCategories);
      localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(initialCategories));
    }

    setIsAppReady(true);
  }, []);

  useEffect(() => {
    if (!auth) {
      setCurrentUser(null);
      setIsAuthReady(true);
      setActiveTab('login');
      window.history.replaceState(null, '', '/login');
      return;
    }

    let isCancelled = false;
    let unsubscribeAuth: Unsubscribe | null = null;

    const initializeAuth = async () => {
      try {
        await authPersistenceReady;
        await getRedirectResult(auth);
      } catch (err) {
        if (!isCancelled) {
          triggerNotification('Google sign-in could not be completed. Please try again.', 'error');
        }
      } finally {
        if (isCancelled) return;

        unsubscribeAuth = onAuthStateChanged(auth, user => {
          setCurrentUser(user);
          setIsAuthReady(true);

          if (user) {
            setCurrentUserRole(getConfiguredRoleForUser(user));
            setIsGuestMode(false);
            setActiveTab('home');
            window.history.replaceState(null, '', '/');
            return;
          }

          setCurrentUserRole('user');
          setAddingRecipe(false);
          setEditingRecipe(null);
          setSelectedRecipe(null);
          setIsNavigationDrawerOpen(false);
          setSelectedHomeCategory(null);
          setIsFavoritesFilterActive(false);
          setIsGuestMode(false);
          setActiveTab('login');
          window.history.replaceState(null, '', '/login');
        });
      }
    };

    initializeAuth();

    return () => {
      isCancelled = true;
      unsubscribeAuth?.();
    };
  }, []);

  useEffect(() => {
    if (currentUser && activeTab === 'login') {
      setActiveTab('home');
    }
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (!isAuthReady || currentUser || isGuestMode || activeTab === 'login') return;

    setAddingRecipe(false);
    setEditingRecipe(null);
    setSelectedRecipe(null);
    setIsNavigationDrawerOpen(false);
    setSelectedHomeCategory(null);
    setIsFavoritesFilterActive(false);
    setActiveTab('login');
    window.history.replaceState(null, '', '/login');
  }, [activeTab, currentUser, isAuthReady, isGuestMode]);

  useEffect(() => {
    if (!currentUser || !db || isGuestMode) return;

    let isCancelled = false;

    const initializeFirestoreUser = async () => {
      try {
        const role = await createUserDocument(currentUser);
        const cloudProfile = await loadFirestoreProfile(currentUser);
        const cloudRecipes = await loadFirestoreRecipes(currentUser);
        const cloudCategories = await loadFirestoreCategories(currentUser);

        if (!isCancelled) {
          setCurrentUserRole(role);
          if (cloudProfile) {
            setChefProfile(cloudProfile);
            setCustomAvatarUrl(cloudProfile.photo);
            localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(cloudProfile));
          }
          setRecipes(cloudRecipes);
          setCategories(cloudCategories);
          localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(cloudCategories));
        }
      } catch (err) {
        if (!isCancelled) {
          triggerNotification('Cloud recipes could not be loaded. Showing local recipes for now.', 'info');
        }
      }
    };

    initializeFirestoreUser();

    return () => {
      isCancelled = true;
    };
  }, [currentUser, isGuestMode]);

  // Save changes helper
  const saveRecipesToStorage = (newList: Recipe[]) => {
    const normalizedList = newList.map(normalizeLoadedRecipe);
    setRecipes(normalizedList);
    localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(normalizedList));
  };

  const saveCategoriesToStorage = (newList: RecipeCategory[]) => {
    setCategories(newList);
    localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(newList));
  };

  const handleCreateCategory = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    if (trimmedName.toLowerCase() === FALLBACK_CATEGORY_NAME.toLowerCase()) {
      triggerNotification(`"${FALLBACK_CATEGORY_NAME}" is reserved for uncategorized recipes.`, 'info');
      return null;
    }

    const existingCategory = categories.find(
      category => category.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (existingCategory) return existingCategory;

    const newCategory = createCategoryRecord(trimmedName);
    saveCategoriesToStorage([...categories, newCategory]);
    if (currentUser && db && !isGuestMode) {
      saveCategoryToFirestore(newCategory, currentUser).catch(() => {
        triggerNotification(`Created "${newCategory.name}" locally. Cloud category sync failed for now.`, 'info');
      });
    }
    triggerNotification(`Created category "${newCategory.name}".`, 'success');
    return newCategory;
  };

  const handleRenameCategory = (categoryId: string, nextName: string) => {
    const trimmedName = nextName.trim();
    if (!trimmedName) return;
    if (trimmedName.toLowerCase() === FALLBACK_CATEGORY_NAME.toLowerCase()) {
      triggerNotification(`"${FALLBACK_CATEGORY_NAME}" is reserved for uncategorized recipes.`, 'info');
      return;
    }

    const category = categories.find(item => item.id === categoryId);
    if (!category) return;
    const duplicate = categories.find(
      item => item.id !== categoryId && item.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      triggerNotification(`Category "${trimmedName}" already exists.`, 'error');
      return;
    }

    const updatedCategories = categories.map(item =>
      item.id === categoryId ? { ...item, name: trimmedName, updatedAt: new Date().toISOString() } : item
    );
    const updatedRecipes = recipes.map(recipe => {
      if (!recipeHasCategory(recipe, category.name)) return recipe;
      const nextCategories = getRecipeCategories(recipe).map(recipeCategory =>
        recipeCategory === category.name ? trimmedName : recipeCategory
      );
      return { ...recipe, category: nextCategories[0], categories: nextCategories };
    });

    saveCategoriesToStorage(updatedCategories);
    saveRecipesToStorage(updatedRecipes);
    if (currentUser && db && !isGuestMode) {
      Promise.all([
        saveCategoryToFirestore({ ...category, name: trimmedName, updatedAt: new Date().toISOString() }, currentUser),
        ...updatedRecipes
          .filter(recipe => recipeHasCategory(recipe, trimmedName))
          .map(recipe => saveRecipeToFirestore(recipe, currentUser))
      ]).catch(() => {
        triggerNotification(`Renamed "${category.name}" locally. Cloud category sync failed for now.`, 'info');
      });
    }
    if (selectedHomeCategory === category.name) {
      setSelectedHomeCategory(trimmedName);
    }
    triggerNotification(`Renamed "${category.name}" to "${trimmedName}".`, 'success');
  };

  const handleDeleteCategory = (categoryId: string, targetCategoryName: string) => {
    const category = categories.find(item => item.id === categoryId);
    if (!category) return;

    const finalTarget = targetCategoryName.trim();
    const targetExists = finalTarget && categories.some(item => item.name === finalTarget);
    const nextCategories = targetExists || !finalTarget
      ? categories.filter(item => item.id !== categoryId)
      : [...categories.filter(item => item.id !== categoryId), createCategoryRecord(finalTarget)];
    const affectedRecipeIds = new Set(
      recipes
        .filter(recipe => recipeHasCategory(recipe, category.name))
        .map(recipe => recipe.id)
    );

    const updatedRecipes = recipes.map(recipe => {
      if (!recipeHasCategory(recipe, category.name)) return recipe;
      const withoutDeleted = getRecipeCategories(recipe).filter(recipeCategory => recipeCategory !== category.name);
      const nextCategories = finalTarget
        ? normalizeRecipeCategories([...withoutDeleted, finalTarget])
        : withoutDeleted;
      return { ...recipe, category: nextCategories[0] || '', categories: nextCategories };
    });

    saveCategoriesToStorage(nextCategories);
    saveRecipesToStorage(updatedRecipes);
    if (currentUser && db && !isGuestMode) {
      Promise.all([
        deleteCategoryFromFirestore(category.id),
        ...updatedRecipes
          .filter(recipe => affectedRecipeIds.has(recipe.id))
          .map(recipe => saveRecipeToFirestore(recipe, currentUser))
      ]).catch(() => {
        triggerNotification(`Deleted "${category.name}" locally. Cloud category sync failed for now.`, 'info');
      });
    }
    if (selectedHomeCategory === category.name) {
      setSelectedHomeCategory(finalTarget || null);
    }
    triggerNotification(
      finalTarget
        ? `Deleted "${category.name}" and moved recipes to "${finalTarget}".`
        : `Deleted "${category.name}" and left recipes uncategorized.`,
      'info'
    );
  };

  // Trigger brief alert notification banner
  const triggerNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // Add Recipe
  const handleSaveNewRecipe = async (newRecipe: Recipe) => {
    setAddingRecipe(false);
    setActiveTab('home');

    if (currentUser && db && !isGuestMode) {
      try {
        const cloudRecipe = await getCloudReadyRecipe(newRecipe, currentUser, (progress, phase) => {
          triggerNotification(`Uploading ${phase === 'scan' ? 'recipe scan' : 'cover image'}... ${progress}%`, 'info');
        });
        const updated = [cloudRecipe, ...recipes];
        setRecipes(updated);
        await saveRecipeToFirestore(cloudRecipe, currentUser);
        triggerNotification(`Saved "${cloudRecipe.title}" to your cookbook.`, 'success');
      } catch (err) {
        const updated = [newRecipe, ...recipes];
        setRecipes(updated);
        localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updated));
        triggerNotification(`Saved "${newRecipe.title}" locally. Cloud save failed for now.`, 'info');
      }
    } else {
      const updated = [newRecipe, ...recipes];
      setRecipes(updated);
      localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updated));
      triggerNotification(`Saved "${newRecipe.title}" locally. Sign in to save future recipes to cloud.`, 'success');
    }
  };

  const handleSaveEditedRecipe = async (updatedRecipe: Recipe) => {
    setEditingRecipe(null);
    setActiveTab('home');

    if (currentUser && db && !isGuestMode) {
      try {
        const cloudRecipe = await getCloudReadyRecipe(updatedRecipe, currentUser, (progress, phase) => {
          triggerNotification(`Uploading ${phase === 'scan' ? 'recipe scan' : 'cover image'}... ${progress}%`, 'info');
        });
        const updated = recipes.map(recipe =>
          recipe.id === cloudRecipe.id ? cloudRecipe : recipe
        );
        setRecipes(updated);
        setSelectedRecipe(cloudRecipe);
        await saveRecipeToFirestore(cloudRecipe, currentUser);
        triggerNotification(`Updated "${cloudRecipe.title}".`, 'success');
      } catch (err) {
        const updated = recipes.map(recipe =>
          recipe.id === updatedRecipe.id ? updatedRecipe : recipe
        );
        setRecipes(updated);
        setSelectedRecipe(updatedRecipe);
        localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updated));
        triggerNotification(`Updated "${updatedRecipe.title}" locally. Cloud sync failed for now.`, 'info');
      }
    } else {
      const updated = recipes.map(recipe =>
        recipe.id === updatedRecipe.id ? updatedRecipe : recipe
      );
      setRecipes(updated);
      setSelectedRecipe(updatedRecipe);
      localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updated));
      triggerNotification(`Updated "${updatedRecipe.title}".`, 'success');
    }
  };

  const handleStartEditRecipe = (recipe: Recipe) => {
    setSelectedRecipe(null);
    setEditingRecipe(recipe);
  };

  const handleDuplicateRecipe = async (recipe: Recipe) => {
    const duplicatedRecipe: Recipe = {
      ...recipe,
      id: `recipe_${Date.now()}`,
      title: `${recipe.title} Copy`,
      scanAttachmentUrl: undefined,
      scannedImageDataUrl: undefined,
      isSaved: false,
      createdAt: new Date().toISOString()
    };
    const updatedRecipes = [duplicatedRecipe, ...recipes];
    setRecipes(updatedRecipes);
    setSelectedRecipe(null);
    setActiveTab('home');

    if (currentUser && db && !isGuestMode) {
      try {
        const cloudRecipe = await getCloudReadyRecipe(duplicatedRecipe, currentUser, (progress, phase) => {
          triggerNotification(`Uploading ${phase === 'scan' ? 'recipe scan' : 'cover image'}... ${progress}%`, 'info');
        });
        const updated = [cloudRecipe, ...recipes];
        setRecipes(updated);
        await saveRecipeToFirestore(cloudRecipe, currentUser);
        triggerNotification(`Duplicated "${recipe.title}".`, 'success');
      } catch (err) {
        localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updatedRecipes));
        triggerNotification(`Duplicated "${recipe.title}" locally. Cloud save failed for now.`, 'info');
      }
      return;
    }

    localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updatedRecipes));
    triggerNotification(`Duplicated "${recipe.title}".`, 'success');
  };

  const handleShareRecipe = async (recipe: Recipe) => {
    const shareText = [
      recipe.title,
      recipe.yield ? `Yield: ${recipe.yield}` : '',
      '',
      'Ingredients:',
      ...recipe.ingredients.map(ingredient =>
        [ingredient.qty, ingredient.unit, ingredient.name].filter(Boolean).join(' ')
      ),
      '',
      'Method:',
      ...recipe.method.map(step => `${step.stepNumber}. ${step.description}`)
    ].filter(Boolean).join('\n');

    try {
      if (navigator.share) {
        await navigator.share({
          title: recipe.title,
          text: shareText
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        triggerNotification('Recipe copied to clipboard.', 'success');
      } else {
        triggerNotification('Sharing is not available in this browser.', 'info');
      }
    } catch (err) {
      triggerNotification('Share was cancelled or could not be completed.', 'info');
    }
  };

  const handleDeleteRecipe = async (recipe: Recipe) => {
    const confirmed = window.confirm('Delete this recipe? This action cannot be undone.');
    if (!confirmed) return;

    const updatedRecipes = recipes.filter(item => item.id !== recipe.id);
    setRecipes(updatedRecipes);
    setSelectedRecipe(null);
    setActiveTab('home');

    if (currentUser && db && !isGuestMode) {
      try {
        await deleteRecipeCoverImage(currentUser.uid, recipe.id);
        await deleteRecipeScanAttachment(currentUser.uid, recipe.id);
        await deleteRecipeFromFirestore(recipe.id);
        triggerNotification(`Deleted "${recipe.title}".`, 'info');
      } catch (err) {
        setRecipes(recipes);
        setSelectedRecipe(recipe);
        triggerNotification(`Could not delete "${recipe.title}" from cloud. Please try again.`, 'error');
      }
      return;
    }

    localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify(updatedRecipes));
    triggerNotification(`Deleted "${recipe.title}".`, 'info');
  };

  const handleCancelRecipeForm = () => {
    setAddingRecipe(false);
    setEditingRecipe(null);
  };

  const handleToggleFavorite = (recipeId: string) => {
    const updatedRecipes = recipes.map(recipe =>
      recipe.id === recipeId ? { ...recipe, isSaved: !recipe.isSaved } : recipe
    );
    saveRecipesToStorage(updatedRecipes);

    const updatedSelectedRecipe = updatedRecipes.find(recipe => recipe.id === selectedRecipe?.id);
    if (updatedSelectedRecipe) {
      setSelectedRecipe(updatedSelectedRecipe);
    }
  };

  const getValidImportedRecipes = (importedRecipes: Recipe[]) => {
    return importedRecipes.filter(recipe =>
      recipe &&
      typeof recipe.id === 'string' &&
      typeof recipe.title === 'string' &&
      Array.isArray(recipe.ingredients) &&
      Array.isArray(recipe.method)
    );
  };

  const getValidImportedCategories = (importedCategories: RecipeCategory[]) => {
    return importedCategories.filter(category =>
      category &&
      typeof category.name === 'string' &&
      category.name.trim()
    );
  };

  const handleImportAppData = (importedData: ImportedAppData, mode: 'merge' | 'replace') => {
    const validRecipes = getValidImportedRecipes(importedData.recipes);
    const validCategories = getValidImportedCategories(importedData.categories);
    const normalizedValidRecipes = validRecipes.map(normalizeLoadedRecipe);

    if (normalizedValidRecipes.length === 0) {
      triggerNotification('No valid recipes found in the selected file.', 'error');
      return;
    }

    if (mode === 'replace') {
      const nextCategories = sanitizeCategoryList(
        validCategories.length > 0 ? validCategories : buildInitialCategories(normalizedValidRecipes)
      );
      saveRecipesToStorage(normalizedValidRecipes);
      saveCategoriesToStorage(nextCategories);
    } else {
      const existingIds = new Set(recipes.map(recipe => recipe.id));
      const normalizedImportedRecipes = normalizedValidRecipes.map(recipe => ({
        ...recipe,
        id: existingIds.has(recipe.id) ? `recipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : recipe.id
      }));
      const updatedRecipes = [...normalizedImportedRecipes, ...recipes];
      saveRecipesToStorage(updatedRecipes);

      const categoryMap = new Map<string, RecipeCategory>();
      categories.forEach(category => categoryMap.set(category.name.toLowerCase(), category));
      validCategories.forEach(category => {
        const key = category.name.trim().toLowerCase();
        if (!categoryMap.has(key)) {
          categoryMap.set(key, {
            ...category,
            id: category.id || createCategoryRecord(category.name).id,
            name: category.name.trim()
          });
        }
      });

      normalizedImportedRecipes.forEach(recipe => {
        getRecipeCategories(recipe).forEach(categoryName => {
          if (categoryName && !categoryMap.has(categoryName.toLowerCase())) {
            categoryMap.set(categoryName.toLowerCase(), createCategoryRecord(categoryName));
          }
        });
      });

      const nextCategories = sanitizeCategoryList(Array.from(categoryMap.values()));
      saveCategoriesToStorage(nextCategories);
    }

    if (importedData.profile) {
      localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(importedData.profile));
    }

    triggerNotification(
      `${mode === 'replace' ? 'Replaced' : 'Merged'} ${normalizedValidRecipes.length} recipes and ${validCategories.length} categories.`,
      'success'
    );
  };

  const handleResetApp = () => {
    Object.keys(localStorage)
      .filter(key => key.startsWith('ce_lims_kitchen_') || key.startsWith('my_cookbook_'))
      .forEach(key => localStorage.removeItem(key));

    const resetCategories: RecipeCategory[] = [];
    setRecipes([]);
    setCategories(resetCategories);
    setCustomAvatarUrl('');
    localStorage.setItem(STORAGE_RECIPES_KEY, JSON.stringify([]));
    localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(resetCategories));
    document.documentElement.dataset.appearance = 'system';
    setSelectedHomeCategory(null);
    setIsFavoritesFilterActive(false);
    setActiveTab('home');
    triggerNotification('Reset complete. Local app data has been cleared.', 'info');
  };

  const handleSignOut = async () => {
    if (!auth) {
      triggerNotification('Authentication is unavailable right now.', 'info');
      return;
    }

    try {
      await signOut(auth);
      setCurrentUser(null);
      setCurrentUserRole('user');
      setIsGuestMode(false);
      setRecipes(loadLocalRecipes());
      setAddingRecipe(false);
      setEditingRecipe(null);
      setSelectedRecipe(null);
      setIsNavigationDrawerOpen(false);
      setSelectedHomeCategory(null);
      setIsFavoritesFilterActive(false);
      setActiveTab('login');
      window.history.replaceState(null, '', '/login');
      triggerNotification('Signed out successfully.', 'info');
    } catch (err) {
      triggerNotification('Unable to sign out. Please try again.', 'error');
    }
  };

  const homeRecipes = isFavoritesFilterActive
    ? recipes.filter(recipe => recipe.isSaved)
    : selectedHomeCategory
      ? recipes.filter(recipe => recipeHasCategory(recipe, selectedHomeCategory))
      : recipes;
  const categoryCounts = categories.reduce<Record<string, number>>((acc, category) => {
    acc[category.name] = recipes.filter(recipe => recipeHasCategory(recipe, category.name)).length;
    return acc;
  }, {});

  // Renders correct active screen body
  const handleAuthenticated = () => {
    setIsGuestMode(false);
    setActiveTab('home');
    window.history.replaceState(null, '', '/');
  };

  const handleContinueAsGuest = () => {
    setCurrentUser(null);
    setCurrentUserRole('user');
    setIsGuestMode(true);
    const localProfile = loadLocalProfile();
    setChefProfile(localProfile);
    setCustomAvatarUrl(localProfile.photo);
    setRecipes(loadLocalRecipes());
    setActiveTab('home');
    window.history.replaceState(null, '', '/');
  };

  const handleAvatarClick = () => {
    setAddingRecipe(false);
    setEditingRecipe(null);
    setSelectedRecipe(null);
    setIsNavigationDrawerOpen(false);

    if (currentUser) {
      setActiveTab('settings');
      window.history.replaceState(null, '', '/settings');
      return;
    }

    setIsGuestMode(false);
    setActiveTab('login');
    window.history.replaceState(null, '', '/login');
  };

  const renderTabContent = () => {
    if (!currentUser && !isGuestMode) {
      return (
        <LoginTab
          currentUser={currentUser}
          onAuthenticated={handleAuthenticated}
          onContinueAsGuest={handleContinueAsGuest}
        />
      );
    }

    switch (activeTab) {
      case 'home':
        return (
          <HomeTab
            recipes={homeRecipes}
            selectedCategory={selectedHomeCategory}
            isFavoritesFilter={isFavoritesFilterActive}
            onSelectRecipe={setSelectedRecipe}
            onToggleFavorite={handleToggleFavorite}
            currentUser={currentUser}
            profile={chefProfile}
            customAvatarUrl={customAvatarUrl}
          />
        );
      case 'favorites':
        return (
          <FavoritesTab
            recipes={recipes}
            collections={collections}
            onAddCollection={() => undefined}
            onSelectRecipe={setSelectedRecipe}
            onToggleSave={handleToggleFavorite}
          />
        );
      case 'statistics':
        return (
          <StatisticsTab
            recipes={recipes}
            categories={categories}
          />
        );
      case 'search':
        return (
          <SearchTab
            recipes={recipes}
            categories={categories}
            onSelectRecipe={setSelectedRecipe}
            onCreateCategory={handleCreateCategory}
            onRenameCategory={handleRenameCategory}
            onDeleteCategory={handleDeleteCategory}
            onToggleFavorite={handleToggleFavorite}
          />
        );
      case 'settings':
        return (
          <SettingsTab
            recipes={recipes}
            categories={categories}
            onImportAppData={handleImportAppData}
            onResetApp={handleResetApp}
            onOpenLogin={() => setActiveTab('login')}
            currentUser={currentUser}
            profile={chefProfile}
            customAvatarUrl={customAvatarUrl}
            onCustomAvatarChange={setCustomAvatarUrl}
            onProfileChange={nextProfile => {
              setChefProfile(nextProfile);
              setCustomAvatarUrl(nextProfile.photo);
            }}
            onSignOut={handleSignOut}
            onNotify={triggerNotification}
          />
        );
      case 'login':
        if (currentUser) {
          return (
            <HomeTab
              recipes={homeRecipes}
              selectedCategory={selectedHomeCategory}
              isFavoritesFilter={isFavoritesFilterActive}
              onSelectRecipe={setSelectedRecipe}
              onToggleFavorite={handleToggleFavorite}
              currentUser={currentUser}
              profile={chefProfile}
              customAvatarUrl={customAvatarUrl}
            />
          );
        }

        return (
          <LoginTab
            currentUser={currentUser}
            onAuthenticated={handleAuthenticated}
            onContinueAsGuest={handleContinueAsGuest}
          />
        );
      default:
        return null;
    }
  };

  // Header Contextual configuration
  const getHeaderProps = () => {
    if (addingRecipe || editingRecipe) {
      return {
        title: editingRecipe ? 'Edit Recipe' : 'Add New Recipe',
        isSubpage: true,
        onBack: handleCancelRecipeForm,
        rightAction: (
          <button
            onClick={() => {
              // Click the hidden submit button on child form
              document.getElementById('add-recipe-hidden-save-btn')?.click();
            }}
            id="app-bar-save-recipe-btn"
            className="bg-primary text-on-primary font-sans font-extrabold text-xs px-6 py-2 rounded-full hover:opacity-90 active:scale-95 transition-all outline-none"
          >
            Save
          </button>
        )
      };
    }

    // Default main navigation header
    return {
      title: "MiseChef",
      isSubpage: false,
      activeTab: activeTab,
      chefAvatarUrl: customAvatarUrl || chefProfile.photo || currentUser?.photoURL || undefined,
      chefName: chefProfile.name || currentUser?.displayName || currentUser?.email || 'User profile',
      showAvatar: Boolean(currentUser),
      onAvatarClick: handleAvatarClick,
      onMenuClick: () => setIsNavigationDrawerOpen(true)
    };
  };

  const isProtectedShellVisible = currentUser || isGuestMode;

  if (!isAppReady || !isAuthReady) {
    return <BrandLoadingScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-secondary/20 bg-background relative overflow-x-hidden">
      {/* Dynamic Header */}
      <Header {...getHeaderProps()} />

      {isProtectedShellVisible && !addingRecipe && !editingRecipe && (
        <NavigationDrawer
          isOpen={isNavigationDrawerOpen}
          categories={categories}
          activeTab={activeTab}
          selectedCategory={selectedHomeCategory}
          isFavoritesFilterActive={isFavoritesFilterActive}
          categoryCounts={categoryCounts}
          onClose={() => setIsNavigationDrawerOpen(false)}
          onNavigate={setActiveTab}
          onSelectCategory={(categoryName) => {
            setSelectedHomeCategory(categoryName);
            setIsFavoritesFilterActive(false);
          }}
          onSelectFavorites={() => {
            setSelectedHomeCategory(null);
            setIsFavoritesFilterActive(true);
          }}
          currentUser={currentUser}
          customAvatarUrl={customAvatarUrl}
          onRenameCategory={handleRenameCategory}
          onDeleteCategory={handleDeleteCategory}
          onSignOut={handleSignOut}
        />
      )}

      {/* Floating Alerts Dialog Banner */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-20 left-4 right-4 md:left-auto md:right-8 md:max-w-md z-50 p-4 rounded-xl border shadow-lg flex items-center gap-3 backdrop-blur-md font-semibold text-xs transition-all"
            style={{
              backgroundColor: notification.type === 'success' ? '#273f2b' : '#3c392e',
              color: '#ffffff',
              borderColor: 'rgba(255,255,255,0.1)'
            }}
          >
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm shrink-0">
              {notification.type === 'success' ? '✨' : '📝'}
            </div>
            <p className="flex-1 font-sans">{notification.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Scaffold Layout Wrapper */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-8 pt-24 pb-28 md:pb-16">
        {editingRecipe ? (
          <AddRecipeTab
            initialRecipe={editingRecipe}
            mode="edit"
            categories={categories}
            onCreateCategory={handleCreateCategory}
            onRenameCategory={handleRenameCategory}
            onDeleteCategory={handleDeleteCategory}
            onSave={handleSaveEditedRecipe}
            onCancel={handleCancelRecipeForm}
            userRole={currentUserRole}
          />
        ) : addingRecipe ? (
          <AddRecipeTab
            categories={categories}
            onCreateCategory={handleCreateCategory}
            onRenameCategory={handleRenameCategory}
            onDeleteCategory={handleDeleteCategory}
            onSave={handleSaveNewRecipe}
            onCancel={handleCancelRecipeForm}
            userRole={currentUserRole}
          />
        ) : (
          renderTabContent()
        )}
      </main>

      {/* Responsive Bottom Navigation Bar Block (Mobile size, Tablet uses top) */}
      {isProtectedShellVisible && !addingRecipe && !editingRecipe && (
        <nav className="fixed bottom-0 left-0 w-full z-45 flex justify-around items-center px-4 pb-4 pt-3 bg-surface/90 backdrop-blur-md rounded-t-2xl shadow-[0_-4px_24px_rgba(62,86,65,0.08)] md:hidden border-t border-surface-container-high transition-transform">
          <button
            onClick={() => {
              setSelectedHomeCategory(null);
              setIsFavoritesFilterActive(false);
              setActiveTab('home');
            }}
            className={`flex flex-col items-center justify-center py-1 transition-all flex-1 ${
              activeTab === 'home' ? 'text-primary font-black scale-103' : 'text-outline hover:text-primary'
            }`}
          >
            <Home className={`w-5 h-5 ${activeTab === 'home' ? 'stroke-[2.5px]' : ''}`} />
            <span className="font-sans font-semibold text-[10px] mt-1.5 uppercase tracking-wide">Home</span>
          </button>

          <button
            onClick={() => setActiveTab('search')}
            className={`flex flex-col items-center justify-center py-1 transition-all flex-1 ${
              activeTab === 'search' ? 'text-primary font-black scale-103' : 'text-outline hover:text-primary'
            }`}
          >
            <Search className={`w-5 h-5 ${activeTab === 'search' ? 'stroke-[2.5px]' : ''}`} />
            <span className="font-sans font-semibold text-[10px] mt-1.5 uppercase tracking-wide font-bold">Search</span>
          </button>
        </nav>
      )}

      {/* Persistent Desktop & Mobile Contextual floating Add Button (FAB) (Matches screenshot button!) */}
      {isProtectedShellVisible && !addingRecipe && !editingRecipe && (
        <button
          onClick={() => setAddingRecipe(true)}
          id="persistent-fab-add-recipe"
          className="fixed bottom-24 right-6 md:bottom-8 md:right-8 w-14 h-14 bg-primary text-on-primary hover:bg-primary-container rounded-full shadow-lg shadow-primary/25 flex items-center justify-center active:scale-95 hover:scale-105 transition-all z-40 outline-none"
          title="Write a new heirloom recipe"
        >
          <Plus className="w-7 h-7 text-white" />
        </button>
      )}

      {/* Recipe Drawer Detail Overlay */}
      <AnimatePresence>
        {selectedRecipe && (
          <RecipeDetailModal
            recipe={selectedRecipe}
            onClose={() => setSelectedRecipe(null)}
            onEdit={handleStartEditRecipe}
            onDuplicate={handleDuplicateRecipe}
            onShare={handleShareRecipe}
            onDelete={handleDeleteRecipe}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
