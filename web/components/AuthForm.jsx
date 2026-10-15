'use client';
import { useState } from 'react';
import { api } from '../lib/api';

/** Sign-in / register in one form. Calls onSuccess(user) after the server sets the session cookie. */
export default function AuthForm({ onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        body: { email, password },
      });
      onSuccess(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-4" aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-2xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <label className="block text-sm font-medium">
        Email
        <input className={field} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-sm font-medium">
        Password
        <input
          className={field}
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="w-full rounded bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register'}
      </button>
      <button
        type="button"
        className="text-sm text-indigo-700 underline"
        onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
      >
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}
