/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { RecipeCategory, RootTab } from '../types';
import BrandLogo from './BrandLogo';

interface NavigationDrawerProps {
  isOpen: boolean;
  categories: RecipeCategory[];
  activeTab: RootTab;
  selectedCategory: string | null;
  isFavoritesFilterActive: boolean;
  onClose: () => void;
  onNavigate: (tab: RootTab) => void;
  onSelectCategory: (categoryName: string | null) => void;
  onSelectFavorites: () => void;
}

export default function NavigationDrawer({
  isOpen,
  categories,
  activeTab,
  selectedCategory,
  isFavoritesFilterActive,
  onClose,
  onNavigate,
  onSelectCategory,
  onSelectFavorites
}: NavigationDrawerProps) {
  const [categoriesOpen, setCategoriesOpen] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleNavigate = (tab: RootTab) => {
    onNavigate(tab);
    onClose();
  };

  const handleCategorySelect = (categoryName: string | null) => {
    onSelectCategory(categoryName);
    onNavigate('home');
    onClose();
  };

  const handleFavoritesSelect = () => {
    onSelectFavorites();
    onNavigate('favorites');
    onClose();
  };

  const staticMenuItems: Array<{ label: string; icon: string; tab?: RootTab }> = [
    { label: 'Statistics', icon: '📊', tab: 'statistics' },
    { label: 'Settings', icon: '⚙️', tab: 'settings' },
    { label: 'Login', icon: '🔐', tab: 'login' }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70]">
          <motion.button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={onClose}
          />

          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            className="absolute left-0 top-0 h-full w-[84vw] max-w-sm bg-background border-r border-surface-container-high shadow-2xl flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="px-5 pt-5 pb-4 border-b border-surface-container-high flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <BrandLogo className="h-8 w-auto shrink-0" />
                <div className="min-w-0">
                  <p className="font-sans text-[10px] font-extrabold uppercase tracking-[0.2em] text-secondary">
                    Menu
                  </p>
                  <h2 className="font-display italic text-2xl text-primary font-semibold">
                    MiseChef
                  </h2>
                  <p className="font-sans text-xs text-on-surface-variant font-bold">
                    Everything in its place. · by Ce Lim
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full text-primary hover:bg-surface-container active:scale-95 transition-all"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              <button
                type="button"
                onClick={() => handleCategorySelect(null)}
                className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-sans font-extrabold text-sm transition-all ${
                  activeTab === 'home' && !selectedCategory && !isFavoritesFilterActive
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-primary hover:bg-surface-container'
                }`}
              >
                <span className="text-lg leading-none">🏠</span>
                <span>Home</span>
              </button>

              <div className="rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCategoriesOpen(prev => !prev)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left font-sans font-extrabold text-sm transition-all ${
                    activeTab === 'search'
                      ? 'bg-primary/10 text-primary'
                      : 'text-primary hover:bg-surface-container'
                  }`}
                  aria-expanded={categoriesOpen}
                >
                  <span className="text-lg leading-none">📚</span>
                  <span className="flex-1">Categories</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${categoriesOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {categoriesOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="ml-8 mr-2 mb-2 space-y-1 border-l border-surface-container-high pl-3">
                        <button
                          type="button"
                          onClick={() => handleCategorySelect(null)}
                          className={`w-full rounded-xl px-3 py-2.5 text-left font-sans text-xs font-bold transition-all ${
                            !selectedCategory && !isFavoritesFilterActive && activeTab === 'home'
                              ? 'bg-primary text-on-primary shadow-sm'
                              : 'text-on-surface-variant hover:bg-surface-container hover:text-primary'
                          }`}
                        >
                          All Recipes
                        </button>
                        {categories.length > 0 ? (
                          categories.map(category => {
                            const isSelected = selectedCategory === category.name && activeTab === 'home';
                            return (
                              <button
                                type="button"
                                key={category.id}
                                onClick={() => handleCategorySelect(category.name)}
                                className={`w-full rounded-xl px-3 py-2.5 text-left font-sans text-xs font-bold transition-all ${
                                  isSelected
                                    ? 'bg-primary text-on-primary shadow-sm'
                                    : 'text-on-surface-variant hover:bg-surface-container hover:text-primary'
                                }`}
                              >
                                {category.name}
                              </button>
                            );
                          })
                        ) : (
                          <p className="px-3 py-2.5 font-sans text-xs font-bold text-outline">
                            No categories yet
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={handleFavoritesSelect}
                className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-sans font-extrabold text-sm hover:bg-surface-container active:scale-[0.99] transition-all ${
                  (isFavoritesFilterActive && activeTab === 'home') || activeTab === 'favorites'
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-primary'
                }`}
              >
                <span className="text-lg leading-none">⭐</span>
                <span>Favorites</span>
              </button>

              {staticMenuItems.map(item => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => (item.tab ? handleNavigate(item.tab) : onClose())}
                  className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-sans font-extrabold text-sm hover:bg-surface-container active:scale-[0.99] transition-all ${
                    item.tab && activeTab === item.tab
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-primary'
                  }`}
                >
                  <span className="text-lg leading-none">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
