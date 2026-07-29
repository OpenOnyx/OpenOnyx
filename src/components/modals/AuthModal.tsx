/**
 * AuthModal -- Supabase Auth UI for login/signup.
 * Shows as a modal overlay. Globally styled matching settings layout premium aesthetics.
 */

import React, { useState, useCallback } from 'react';
import { X, Mail, Lock, LogIn, UserPlus, AlertCircle, Loader2 } from 'lucide-react';
import { authManager } from '../../lib/auth';

interface AuthModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  message?: string;
  initialMode?: 'login' | 'signup';
}

export function AuthModal({ onClose, onSuccess, message, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'login') {
        await authManager.signInWithEmail(email, password);
        onSuccess?.();
        onClose();
      } else {
        await authManager.signUpWithEmail(email, password);
        setSignupSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  }, [mode, email, password, onClose, onSuccess]);

  return (
    <div className="oo-host-modal-overlay fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div className="oo-host-modal w-full max-w-[400px] overflow-hidden rounded-xl border border-[var(--oo-border-medium,var(--border-strong))] bg-[var(--oo-surface-0,var(--bg-primary))] shadow-[0_20px_48px_rgba(0,0,0,0.4)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--oo-border-subtle,var(--border-subtle))] bg-[var(--oo-surface-1,var(--bg-secondary))] px-5 py-4">
          <h3 className="m-0 text-[13px] font-semibold text-[var(--oo-text-primary,var(--text-primary))]">{mode === 'login' ? 'Sign in' : 'Create account'}</h3>
          <button className="flex cursor-pointer rounded border-none bg-transparent p-1 text-[var(--oo-text-muted,var(--text-muted))] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--oo-text-primary,var(--text-primary))]" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {message && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--oo-accent,rgba(232,168,74,0.25))] bg-[var(--oo-accent-muted,rgba(232,168,74,0.1))] px-3 py-2 text-xs text-[var(--oo-accent-text,var(--text-primary))]">
              <AlertCircle size={14} />
              <span>{message}</span>
            </div>
          )}

          {signupSuccess ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-[var(--oo-text-primary,var(--text-primary))]">Check your email for a confirmation link.</p>
              <button
                className="mt-3 cursor-pointer rounded-md border border-[var(--oo-border-medium,var(--border-medium))] bg-[var(--oo-surface-3,var(--bg-tertiary))] px-3.5 py-1.5 text-[13px] font-medium text-[var(--oo-text-primary,var(--text-primary))] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                onClick={() => { setSignupSuccess(false); setMode('login'); }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--oo-text-muted,var(--text-muted))]"><Mail size={12} /> Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    className="w-full rounded-md border border-[var(--oo-border-subtle,var(--border-subtle))] bg-[var(--oo-surface-1,var(--bg-secondary))] px-3 py-2 text-sm text-[var(--oo-text-primary,var(--text-primary))] outline-none transition-colors duration-200 placeholder:text-[var(--oo-text-muted,var(--text-muted))] focus:border-[var(--oo-accent,var(--border-strong))]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--oo-text-muted,var(--text-muted))]"><Lock size={12} /> Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full rounded-md border border-[var(--oo-border-subtle,var(--border-subtle))] bg-[var(--oo-surface-1,var(--bg-secondary))] px-3 py-2 text-sm text-[var(--oo-text-primary,var(--text-primary))] outline-none transition-colors duration-200 placeholder:text-[var(--oo-text-muted,var(--text-muted))] focus:border-[var(--oo-accent,var(--border-strong))]"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/[0.08] border border-red-500/15 rounded px-3 py-2">
                    <AlertCircle size={12} />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border-none bg-[var(--oo-accent,var(--accent-primary))] px-4 py-2.5 text-sm font-semibold text-[var(--oo-accent-on,var(--text-on-accent))] transition-colors duration-200 hover:bg-[var(--oo-accent-hover,var(--accent-secondary))] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <><Loader2 size={14} className="animate-spin" /> Loading…</>
                  ) : mode === 'login' ? (
                    <><LogIn size={14} /> Sign in</>
                  ) : (
                    <><UserPlus size={14} /> Create account</>
                  )}
                </button>
              </form>

              <div className="mt-4 text-center text-xs text-[var(--oo-text-muted,var(--text-muted))]">
                {mode === 'login' ? (
                  <span>
                    Don't have an account?{' '}
                    <button className="cursor-pointer border-none bg-transparent p-0 text-xs font-medium text-[var(--oo-accent-text,var(--accent-primary))] hover:underline" onClick={() => { setMode('signup'); setError(null); }}>
                      Sign up
                    </button>
                  </span>
                ) : (
                  <span>
                    Already have an account?{' '}
                    <button className="cursor-pointer border-none bg-transparent p-0 text-xs font-medium text-[var(--oo-accent-text,var(--accent-primary))] hover:underline" onClick={() => { setMode('login'); setError(null); }}>
                      Sign in
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
