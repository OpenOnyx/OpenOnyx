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
    <div className="motion-dialog-backdrop fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="motion-dialog bg-(--bg-primary) border border-(--border-strong) rounded-lg w-full max-w-[400px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--border-subtle) bg-(--bg-secondary)">
          <h3 className="text-[13px] font-semibold m-0 text-(--text-primary)">{mode === 'login' ? 'Sign In' : 'Create Account'}</h3>
          <button className="bg-transparent border-none text-(--text-muted) cursor-pointer p-1 rounded flex transition-colors duration-150 hover:bg-(--bg-hover) hover:text-(--text-primary)" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {message && (
            <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-blue-400 text-xs">
              <AlertCircle size={14} />
              <span>{message}</span>
            </div>
          )}

          {signupSuccess ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-(--text-primary)">Check your email for a confirmation link!</p>
              <button
                className="bg-(--bg-tertiary) border border-(--border-medium) rounded px-3.5 py-1.5 text-[13px] font-medium cursor-pointer text-(--text-primary) mt-3 transition-colors duration-150 hover:bg-(--bg-hover)"
                onClick={() => { setSignupSuccess(false); setMode('login'); }}
              >
                Back to Sign In
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--text-muted)"><Mail size={12} /> Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    className="w-full px-3 py-2 rounded bg-(--bg-secondary) border border-(--border-subtle) text-(--text-primary) text-sm outline-none transition-colors duration-200 focus:border-(--border-strong) placeholder:text-(--text-muted)"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--text-muted)"><Lock size={12} /> Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full px-3 py-2 rounded bg-(--bg-secondary) border border-(--border-subtle) text-(--text-primary) text-sm outline-none transition-colors duration-200 focus:border-(--border-strong) placeholder:text-(--text-muted)"
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
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-(--accent-primary) text-(--text-on-accent) text-sm font-semibold border-none cursor-pointer transition-colors duration-200 hover:bg-(--accent-secondary) disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <><Loader2 size={14} className="animate-spin" /> Loading...</>
                  ) : mode === 'login' ? (
                    <><LogIn size={14} /> Sign In</>
                  ) : (
                    <><UserPlus size={14} /> Create Account</>
                  )}
                </button>
              </form>

              <div className="text-center mt-4 text-xs text-(--text-muted)">
                {mode === 'login' ? (
                  <span>
                    Don't have an account?{' '}
                    <button className="bg-transparent border-none text-(--accent-primary) cursor-pointer text-xs font-medium p-0 hover:underline" onClick={() => { setMode('signup'); setError(null); }}>
                      Sign up
                    </button>
                  </span>
                ) : (
                  <span>
                    Already have an account?{' '}
                    <button className="bg-transparent border-none text-(--accent-primary) cursor-pointer text-xs font-medium p-0 hover:underline" onClick={() => { setMode('login'); setError(null); }}>
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
