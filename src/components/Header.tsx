/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Menu, ArrowLeft } from 'lucide-react';
import { RootTab } from '../types';
import BrandLogo from './BrandLogo';

interface HeaderProps {
  title?: string;
  isSubpage?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  activeTab?: RootTab;
  chefAvatarUrl?: string;
  chefName?: string;
  onMenuClick?: () => void;
}

export default function Header({
  title = "MiseChef",
  isSubpage = false,
  onBack,
  rightAction,
  activeTab,
  chefAvatarUrl = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
  chefName = "User profile",
  onMenuClick
}: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 w-full z-50 h-16 bg-surface/85 backdrop-blur-md border-b border-surface-container-high transition-all">
      <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 md:px-8 flex justify-between items-center">
        {/* Left Side */}
        <div className="flex items-center gap-3">
          {isSubpage ? (
            <button
              onClick={onBack}
              id="header-back-btn"
              className="p-2 -ml-2 rounded-full hover:bg-surface-container active:scale-95 transition-all text-primary"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <button
              id="header-menu-btn"
              onClick={onMenuClick}
              className="p-2 -ml-2 rounded-full hover:bg-surface-container active:scale-95 transition-all text-primary"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          
          <div className="flex items-center gap-2.5 min-w-0">
            {title === "MiseChef" && (
              <BrandLogo className="h-8 sm:h-9 w-auto shrink-0" />
            )}
            <div className="leading-tight min-w-0">
              <h1 className={`text-xl sm:text-2xl text-primary font-semibold tracking-tight ${title === "MiseChef" ? "font-display italic" : "font-display"}`}>
                {title}
              </h1>
              {!isSubpage && (
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <p className="font-sans text-[10px] sm:text-xs text-secondary font-bold tracking-wide">
                    Everything in its place.
                  </p>
                  <p className="font-sans text-[8px] sm:text-[9px] text-outline font-extrabold uppercase tracking-[0.16em]">
                    by Ce Lim
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {rightAction ? (
            rightAction
          ) : (
            <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-primary-container/20 hover:ring-primary/40 transition-all cursor-pointer">
              <img
                src={chefAvatarUrl}
                alt={chefName}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
