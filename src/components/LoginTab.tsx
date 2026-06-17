/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

type AuthView = 'welcome' | 'sign-in' | 'create-account' | 'forgot-password' | 'guest';

const fieldClass =
  'w-full bg-white border border-surface-container-high rounded-xl px-4 py-3.5 text-sm font-sans font-bold text-on-surface placeholder:text-outline-variant focus:ring-1 focus:ring-primary';
const labelClass = 'font-sans font-bold text-xs text-on-surface-variant px-1';
const primaryButtonClass =
  'w-full bg-primary hover:bg-primary-container text-on-primary rounded-full px-5 py-3.5 text-sm font-sans font-extrabold active:scale-95 transition-all';
const secondaryButtonClass =
  'w-full bg-white border border-surface-container-high text-primary rounded-full px-5 py-3.5 text-sm font-sans font-extrabold active:scale-95 hover:border-primary transition-all';
const linkButtonClass =
  'font-sans text-xs font-extrabold text-primary hover:text-primary-container transition-colors';

function AuthHeader({
  eyebrow = 'Ce Lim\'s Kitchen',
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="text-center space-y-2">
      <p className="font-sans text-[10px] font-extrabold uppercase tracking-[0.2em] text-secondary">
        {eyebrow}
      </p>
      <h2 className="font-display text-3xl sm:text-4xl font-bold text-primary leading-tight">
        {title}
      </h2>
      {subtitle ? (
        <p className="font-sans text-sm font-bold text-on-surface-variant">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function FormField({
  label,
  type,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={fieldClass}
      />
    </div>
  );
}

export default function LoginTab() {
  const [view, setView] = useState<AuthView>('welcome');

  const preventAuthSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <div className="min-h-[calc(100vh-12rem)] flex items-center justify-center animate-fade-in">
      <section className="w-full max-w-md bg-surface-container-low border border-surface-container-high rounded-2xl shadow-sm p-5 sm:p-7 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="space-y-6"
          >
            {view === 'welcome' ? (
              <>
                <AuthHeader
                  title="Ce Lim's Kitchen"
                  subtitle="Professional Recipe Management for Chefs"
                />

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setView('sign-in')}
                    className={primaryButtonClass}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('create-account')}
                    className={secondaryButtonClass}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('guest')}
                    className={secondaryButtonClass}
                  >
                    Continue as Guest
                  </button>
                </div>
              </>
            ) : null}

            {view === 'sign-in' ? (
              <>
                <AuthHeader title="Sign In" subtitle="Welcome back to your kitchen." />

                <form className="space-y-4" onSubmit={preventAuthSubmit}>
                  <FormField
                    label="Email"
                    type="email"
                    placeholder="chef@example.com"
                    autoComplete="email"
                  />
                  <FormField
                    label="Password"
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />

                  <button type="submit" className={primaryButtonClass}>
                    Sign In
                  </button>
                </form>

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-surface-container-high" />
                  <span className="font-sans text-xs font-bold text-on-surface-variant">or</span>
                  <div className="h-px flex-1 bg-surface-container-high" />
                </div>

                <button type="button" className={secondaryButtonClass}>
                  Continue with Google (Coming Soon)
                </button>

                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                  <button
                    type="button"
                    onClick={() => setView('forgot-password')}
                    className={linkButtonClass}
                  >
                    Forgot Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('create-account')}
                    className={linkButtonClass}
                  >
                    Create Account
                  </button>
                </div>
              </>
            ) : null}

            {view === 'create-account' ? (
              <>
                <AuthHeader title="Create Account" subtitle="Prepare for future cloud sync." />

                <form className="space-y-4" onSubmit={preventAuthSubmit}>
                  <FormField
                    label="Full Name"
                    type="text"
                    placeholder="Ce Lim"
                    autoComplete="name"
                  />
                  <FormField
                    label="Email"
                    type="email"
                    placeholder="chef@example.com"
                    autoComplete="email"
                  />
                  <FormField
                    label="Password"
                    type="password"
                    placeholder="Create a password"
                    autoComplete="new-password"
                  />
                  <FormField
                    label="Confirm Password"
                    type="password"
                    placeholder="Confirm your password"
                    autoComplete="new-password"
                  />

                  <button type="submit" className={primaryButtonClass}>
                    Create Account
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => setView('sign-in')}
                  className={`${secondaryButtonClass} !py-3`}
                >
                  Back to Sign In
                </button>
              </>
            ) : null}

            {view === 'forgot-password' ? (
              <>
                <AuthHeader
                  title="Forgot Password"
                  subtitle="Enter your email to prepare a reset request."
                />

                <form className="space-y-4" onSubmit={preventAuthSubmit}>
                  <FormField
                    label="Email"
                    type="email"
                    placeholder="chef@example.com"
                    autoComplete="email"
                  />

                  <button type="submit" className={primaryButtonClass}>
                    Send Reset Link
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => setView('sign-in')}
                  className={`${secondaryButtonClass} !py-3`}
                >
                  Back to Sign In
                </button>
              </>
            ) : null}

            {view === 'guest' ? (
              <>
                <AuthHeader
                  title="Guest Mode"
                  subtitle="Keep using your local cookbook on this device."
                />

                <p className="text-center font-sans text-xs font-extrabold text-secondary bg-secondary/10 border border-secondary/20 rounded-full px-4 py-2">
                  Cloud Sync is available after signing in.
                </p>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setView('sign-in')}
                    className={primaryButtonClass}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('welcome')}
                    className={secondaryButtonClass}
                  >
                    Back to Welcome
                  </button>
                </div>
              </>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  );
}
