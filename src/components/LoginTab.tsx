/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import BrandLogo from './BrandLogo';
import { auth, isFirebaseConfigured } from '../firebase';

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
  title,
  subtitle,
  caption = 'by Ce Lim',
}: {
  title: string;
  subtitle?: string;
  caption?: string;
}) {
  return (
    <div className="text-center space-y-3">
      <BrandLogo className="h-20 w-auto mx-auto" />
      <h2 className="font-display text-3xl sm:text-4xl font-bold text-primary leading-tight">
        {title}
      </h2>
      {subtitle ? (
        <p className="font-sans text-sm font-bold text-on-surface-variant">
          {subtitle}
        </p>
      ) : null}
      {caption ? (
        <p className="font-sans text-[9px] font-extrabold uppercase tracking-[0.22em] text-outline">
          {caption}
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
  value,
  onChange,
}: {
  label: string;
  type: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={event => onChange(event.target.value)}
        className={fieldClass}
      />
    </div>
  );
}

const getAuthErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was closed before it finished.';
    case 'auth/popup-blocked':
      return 'Please allow popups to continue with Google.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
  }
};

interface LoginTabProps {
  currentUser: User | null;
  onAuthenticated: () => void;
  onContinueAsGuest: () => void;
}

export default function LoginTab({ currentUser, onAuthenticated, onContinueAsGuest }: LoginTabProps) {
  const [view, setView] = useState<AuthView>('welcome');
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearAuthStatus = () => {
    setAuthMessage('');
    setAuthError('');
  };

  const ensureFirebaseAuth = () => {
    if (!isFirebaseConfigured || !auth) {
      setAuthError('Authentication is unavailable right now. Please try again later.');
      return false;
    }

    return true;
  };

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAuthStatus();
    if (!ensureFirebaseAuth()) return;

    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, signInEmail.trim(), signInPassword);
      setAuthMessage('Signed in successfully.');
      onAuthenticated();
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    clearAuthStatus();
    if (!ensureFirebaseAuth()) return;

    setIsSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      setAuthMessage('Signed in with Google successfully.');
      onAuthenticated();
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
        try {
          const provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: 'select_account' });
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          setAuthError(getAuthErrorMessage(redirectError));
          setIsSubmitting(false);
          return;
        }
      }
      setAuthError(getAuthErrorMessage(error));
      setIsSubmitting(false);
    } finally {
      if (auth.currentUser) {
        setAuthMessage('Signed in with Google successfully.');
        onAuthenticated();
        setIsSubmitting(false);
      }
    }
  };

  const handleCreateAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAuthStatus();
    if (!ensureFirebaseAuth()) return;

    if (createPassword !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, createEmail.trim(), createPassword);
      if (fullName.trim()) {
        await updateProfile(credential.user, { displayName: fullName.trim() });
      }
      setAuthMessage('Account created successfully.');
      onAuthenticated();
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAuthStatus();
    if (!ensureFirebaseAuth()) return;

    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setAuthMessage('Password reset email sent.');
    } catch (error) {
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchView = (nextView: AuthView) => {
    clearAuthStatus();
    setView(nextView);
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
                  title="MiseChef"
                  subtitle={currentUser?.email ? `Signed in as ${currentUser.email}` : 'Everything in its place.'}
                />

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => switchView('sign-in')}
                    className={primaryButtonClass}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView('create-account')}
                    className={secondaryButtonClass}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={onContinueAsGuest}
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

                <form className="space-y-4" onSubmit={handleSignIn}>
                  <FormField
                    label="Email"
                    type="email"
                    placeholder="chef@example.com"
                    autoComplete="email"
                    value={signInEmail}
                    onChange={setSignInEmail}
                  />
                  <FormField
                    label="Password"
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    value={signInPassword}
                    onChange={setSignInPassword}
                  />

                  <button type="submit" className={primaryButtonClass} disabled={isSubmitting}>
                    {isSubmitting ? 'Signing In...' : 'Sign In'}
                  </button>
                </form>

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-surface-container-high" />
                  <span className="font-sans text-xs font-bold text-on-surface-variant">or</span>
                  <div className="h-px flex-1 bg-surface-container-high" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className={secondaryButtonClass}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Opening Google...' : 'Continue with Google'}
                </button>

                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                  <button
                    type="button"
                    onClick={() => switchView('forgot-password')}
                    className={linkButtonClass}
                  >
                    Forgot Password
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView('create-account')}
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

                <form className="space-y-4" onSubmit={handleCreateAccount}>
                  <FormField
                    label="Full Name"
                    type="text"
                    placeholder="Ce Lim"
                    autoComplete="name"
                    value={fullName}
                    onChange={setFullName}
                  />
                  <FormField
                    label="Email"
                    type="email"
                    placeholder="chef@example.com"
                    autoComplete="email"
                    value={createEmail}
                    onChange={setCreateEmail}
                  />
                  <FormField
                    label="Password"
                    type="password"
                    placeholder="Create a password"
                    autoComplete="new-password"
                    value={createPassword}
                    onChange={setCreatePassword}
                  />
                  <FormField
                    label="Confirm Password"
                    type="password"
                    placeholder="Confirm your password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                  />

                  <button type="submit" className={primaryButtonClass} disabled={isSubmitting}>
                    {isSubmitting ? 'Creating Account...' : 'Create Account'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => switchView('sign-in')}
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

                <form className="space-y-4" onSubmit={handlePasswordReset}>
                  <FormField
                    label="Email"
                    type="email"
                    placeholder="chef@example.com"
                    autoComplete="email"
                    value={resetEmail}
                    onChange={setResetEmail}
                  />

                  <button type="submit" className={primaryButtonClass} disabled={isSubmitting}>
                    {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => switchView('sign-in')}
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
                    onClick={() => switchView('sign-in')}
                    className={primaryButtonClass}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView('welcome')}
                    className={secondaryButtonClass}
                  >
                    Back to Welcome
                  </button>
                </div>
              </>
            ) : null}

            {(authMessage || authError) && (
              <p className={`text-center font-sans text-xs font-extrabold rounded-xl px-4 py-3 ${
                authError
                  ? 'text-secondary bg-secondary/10 border border-secondary/20'
                  : 'text-primary bg-primary/10 border border-primary/15'
              }`}>
                {authError || authMessage}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  );
}
