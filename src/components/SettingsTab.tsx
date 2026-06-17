/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Camera, Download, RotateCcw, Upload } from 'lucide-react';
import type { User } from 'firebase/auth';
import { Recipe, RecipeCategory } from '../types';

const CHEF_PROFILE_STORAGE_KEY = 'ce_lims_kitchen_chef_profile_v1';
const APPEARANCE_STORAGE_KEY = 'ce_lims_kitchen_appearance_v1';
const APP_VERSION = '0.0.0';

type AppearanceMode = 'light' | 'dark' | 'system';

interface ChefProfile {
  photo: string;
  name: string;
  jobTitle: string;
  yearsExperience: string;
  bio: string;
  quote: string;
}

interface SettingsTabProps {
  recipes: Recipe[];
  categories: RecipeCategory[];
  onImportAppData: (data: ImportedAppData, mode: 'merge' | 'replace') => void;
  onResetApp: () => void;
  onOpenLogin: () => void;
  currentUser: User | null;
  onSignOut: () => void;
}

export interface ImportedAppData {
  recipes: Recipe[];
  categories: RecipeCategory[];
  profile?: Partial<ChefProfile>;
}

const DEFAULT_CHEF_PROFILE: ChefProfile = {
  photo: '',
  name: 'Ce Lim',
  jobTitle: 'Junior Sous Chef',
  yearsExperience: '8+',
  bio: 'Passionate chef specializing in bakery, pastry, school meals, and recipe development.',
  quote: 'Every recipe tells a story.'
};

const applyAppearanceMode = (mode: AppearanceMode) => {
  document.documentElement.dataset.appearance = mode;
};

export default function SettingsTab({
  recipes,
  categories,
  onImportAppData,
  onResetApp,
  onOpenLogin,
  currentUser,
  onSignOut
}: SettingsTabProps) {
  const [profile, setProfile] = useState<ChefProfile>(DEFAULT_CHEF_PROFILE);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>('system');
  const [dataMessage, setDataMessage] = useState('');

  useEffect(() => {
    const cachedProfile = localStorage.getItem(CHEF_PROFILE_STORAGE_KEY);
    const cachedAppearance = localStorage.getItem(APPEARANCE_STORAGE_KEY) as AppearanceMode | null;

    if (cachedProfile) {
      try {
        setProfile({
          ...DEFAULT_CHEF_PROFILE,
          ...JSON.parse(cachedProfile)
        });
      } catch (err) {
        setProfile(DEFAULT_CHEF_PROFILE);
      }
    }

    if (cachedAppearance && ['light', 'dark', 'system'].includes(cachedAppearance)) {
      setAppearanceMode(cachedAppearance);
      applyAppearanceMode(cachedAppearance);
    }
  }, []);

  const updateProfile = (field: keyof ChefProfile, value: string) => {
    setProfile(prev => {
      const nextProfile = { ...prev, [field]: value };
      localStorage.setItem(CHEF_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
      return nextProfile;
    });
  };

  const handleProfilePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      if (event.target?.result) {
        updateProfile('photo', event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAppearanceChange = (mode: AppearanceMode) => {
    setAppearanceMode(mode);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
    applyAppearanceMode(mode);
  };

  const handleExportRecipes = () => {
    const payload = {
      app: "MiseChef",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        recipes,
        categories,
        profile
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `misechef-recipes-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDataMessage(`Exported ${recipes.length} recipes, ${categories.length} categories, and profile.`);
  };

  const parseImportedAppData = (parsed: any): ImportedAppData => {
    const data = parsed?.data || parsed;
    const importedRecipes = Array.isArray(data) ? data : data?.recipes;
    const importedCategories = data?.categories;
    const importedProfile = data?.profile;

    if (!Array.isArray(importedRecipes)) {
      throw new Error('Import file must contain a recipes array.');
    }

    return {
      recipes: importedRecipes as Recipe[],
      categories: Array.isArray(importedCategories) ? importedCategories as RecipeCategory[] : [],
      profile: importedProfile && typeof importedProfile === 'object' ? importedProfile as Partial<ChefProfile> : undefined
    };
  };

  const handleImportRecipesFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const parsed = JSON.parse(String(event.target?.result || ''));
        const importedData = parseImportedAppData(parsed);

        if (!window.confirm("Import this MiseChef data file?")) {
          return;
        }

        const importMode = window.confirm(
          'Replace existing recipes, categories, and profile?\\n\\nOK = Replace existing data\\nCancel = Merge with existing data'
        )
          ? 'replace'
          : 'merge';

        if (importedData.profile) {
          const nextProfile = {
            ...DEFAULT_CHEF_PROFILE,
            ...(importMode === 'merge' ? profile : {}),
            ...importedData.profile
          };
          setProfile(nextProfile);
          localStorage.setItem(CHEF_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
          importedData.profile = nextProfile;
        }

        onImportAppData(importedData, importMode);
        setDataMessage(
          `${importMode === 'replace' ? 'Replaced' : 'Merged'} ${importedData.recipes.length} recipes, ${importedData.categories.length} categories, and profile data.`
        );
      } catch (err) {
        setDataMessage(err instanceof Error ? err.message : 'Unable to import app data.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleResetApp = () => {
    if (!window.confirm("Reset MiseChef? This will clear all local recipes, categories, profile, and settings.")) {
      return;
    }

    onResetApp();
    setProfile(DEFAULT_CHEF_PROFILE);
    setAppearanceMode('system');
    applyAppearanceMode('system');
    setDataMessage('Local app data has been reset.');
  };

  const sectionTitleClass = 'font-display text-xl font-bold text-primary';
  const sectionClass = 'bg-surface-container-low border border-surface-container-high rounded-2xl p-5 sm:p-6 shadow-sm space-y-5';
  const inputClass = 'w-full bg-white border border-surface-container-high rounded-xl px-4 py-3 text-sm font-sans font-bold text-on-surface focus:ring-1 focus:ring-primary';

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div>
        <p className="font-sans text-[10px] font-extrabold uppercase tracking-[0.2em] text-secondary">
          Personal Cookbook
        </p>
        <h2 className="font-display text-3xl sm:text-4xl font-bold text-primary tracking-tight">
          Settings
        </h2>
      </div>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>Profile</h3>
        <div className="flex flex-col sm:flex-row gap-5">
          <label className="relative w-28 h-28 rounded-2xl overflow-hidden bg-primary/10 border border-surface-container-high flex items-center justify-center text-primary cursor-pointer hover:border-primary transition-colors shrink-0">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleProfilePhotoChange}
            />
            {profile.photo ? (
              <img src={profile.photo} alt={profile.name} className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-3xl font-bold">CL</span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-primary/85 text-white text-[10px] font-sans font-bold py-1 flex items-center justify-center gap-1">
              <Camera className="w-3 h-3" />
              Change Photo
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
            <div className="space-y-1.5">
              <label className="font-sans font-bold text-xs text-on-surface-variant px-1">Name</label>
              <input className={inputClass} value={profile.name} onChange={e => updateProfile('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="font-sans font-bold text-xs text-on-surface-variant px-1">Job Title</label>
              <input className={inputClass} value={profile.jobTitle} onChange={e => updateProfile('jobTitle', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="font-sans font-bold text-xs text-on-surface-variant px-1">Bio</label>
              <textarea
                className={`${inputClass} resize-none`}
                rows={4}
                value={profile.bio}
                onChange={e => updateProfile('bio', e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="font-sans font-bold text-xs text-on-surface-variant px-1">Personal Quote</label>
              <input
                className={inputClass}
                value={profile.quote}
                onChange={e => updateProfile('quote', e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>Appearance</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { value: 'light', label: 'Light Mode' },
            { value: 'dark', label: 'Dark Mode' },
            { value: 'system', label: 'System Default' }
          ].map(option => (
            <button
              type="button"
              key={option.value}
              onClick={() => handleAppearanceChange(option.value as AppearanceMode)}
              className={`rounded-2xl px-4 py-3 text-left font-sans font-extrabold text-sm border transition-all ${
                appearanceMode === option.value
                  ? 'bg-primary text-on-primary border-primary shadow-sm'
                  : 'bg-white text-primary border-surface-container-high hover:border-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>Data</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleExportRecipes}
            className="flex items-center justify-center gap-2 rounded-full bg-primary text-on-primary px-5 py-3 text-xs font-sans font-bold active:scale-95 transition-all"
          >
            <Download className="w-4 h-4" />
            Export Recipes
          </button>
          <label className="flex items-center justify-center gap-2 rounded-full bg-white border border-surface-container-high text-primary px-5 py-3 text-xs font-sans font-bold cursor-pointer hover:border-primary active:scale-95 transition-all">
            <input type="file" accept="application/json,.json" className="hidden" onChange={handleImportRecipesFile} />
            <Upload className="w-4 h-4" />
            Import Recipes
          </label>
          <button
            type="button"
            onClick={handleResetApp}
            className="flex items-center justify-center gap-2 rounded-full bg-surface-container border border-surface-container-high text-primary px-5 py-3 text-xs font-sans font-bold active:scale-95 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            Reset App
          </button>
        </div>
        {dataMessage && (
          <p className="font-sans text-xs font-bold text-secondary bg-secondary/10 border border-secondary/20 rounded-xl p-3">
            {dataMessage}
          </p>
        )}
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>About</h3>
        <div className="divide-y divide-surface-container-high rounded-2xl overflow-hidden border border-surface-container-high bg-white">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="font-sans font-bold text-sm text-primary">App Version</span>
            <span className="font-sans font-bold text-xs text-on-surface-variant">{APP_VERSION}</span>
          </div>
          <button type="button" className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-container-low transition-colors">
            <span className="font-sans font-bold text-sm text-primary">Privacy Policy</span>
            <span className="font-sans font-bold text-xs text-on-surface-variant">Local-only</span>
          </button>
          <button type="button" className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-container-low transition-colors">
            <span className="font-sans font-bold text-sm text-primary">Terms of Service</span>
            <span className="font-sans font-bold text-xs text-on-surface-variant">Personal use</span>
          </button>
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>Account</h3>
        <p className="font-sans text-xs font-bold text-on-surface-variant">
          {currentUser?.email ? `Signed in as ${currentUser.email}` : 'Cloud Sync is available after signing in.'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onOpenLogin}
            className="rounded-full bg-surface-container text-primary px-5 py-3 text-xs font-sans font-bold"
          >
            {currentUser ? 'Manage Login' : 'Login'}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            disabled={!currentUser}
            className="rounded-full bg-surface-container-high text-outline px-5 py-3 text-xs font-sans font-bold disabled:cursor-not-allowed disabled:opacity-70"
          >
            Sign Out
          </button>
        </div>
      </section>
    </div>
  );
}
