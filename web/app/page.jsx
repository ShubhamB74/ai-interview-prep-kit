'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import AuthForm from '../components/AuthForm';
import NewKitForm from '../components/NewKitForm';

export default function Home() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [kits, setKits] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const handleAuthError = useCallback((err) => {
    if (err.status === 401) { setUser(null); setNotice(err.code === 'SESSION_EXPIRED' ? 'Your session expired. Please sign in again.' : null); }
    else setError(err.message);
  }, []);

  const loadKits = useCallback(() => api('/kits').then((d) => setKits(d.kits)).catch(handleAuthError), [handleAuthError]);

  useEffect(() => {
    api('/auth/me').then((d) => setUser(d.user)).catch((err) => { if (err.status === 401) setUser(null); else setError(err.message); });
  }, []);
  useEffect(() => { if (user) loadKits(); }, [user, loadKits]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null); setKits(null);
  }

  async function remove(id) {
    try { await api(`/kits/${id}`, { method: 'DELETE' }); setKits((k) => k.filter((x) => x.id !== id)); }
    catch (err) { handleAuthError(err); }
  }

  if (error) return <p role="alert" className="rounded bg-red-50 p-3 text-red-700">Can’t reach the server: {error}</p>;
  if (user === undefined) return <p className="text-slate-500">Loading…</p>;
  if (user === null) return (
    <>
      {notice && <p role="status" className="mb-4 rounded bg-amber-50 p-2 text-sm text-amber-800">{notice}</p>}
      <AuthForm onSuccess={(u) => { setNotice(null); setUser(u); }} />
    </>
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your kits</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-600">{user.email}</span>
          <button onClick={logout} className="rounded border px-3 py-1">Sign out</button>
        </div>
      </header>

      <NewKitForm onCreated={(kit, duplicate) => {
        setNotice(duplicate ? 'You already have a kit for this posting and company — showing it below.' : null);
        loadKits();
      }} />
      {notice && <p role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-800">{notice}</p>}

      {kits === null ? <p className="text-slate-500">Loading kits…</p>
        : kits.length === 0 ? <p className="rounded border border-dashed p-6 text-center text-slate-500">No kits yet. Create your first one above.</p>
        : (
          <ul className="space-y-2">
            {kits.map((k) => (
              <li key={k.id} className="flex items-center justify-between rounded border bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{k.title}</p>
                  <p className="truncate text-sm text-slate-500">{k.company_url} · {k.days} day{k.days === 1 ? '' : 's'} · {k.status}</p>
                </div>
                <button onClick={() => remove(k.id)} className="ml-3 rounded border px-2 py-1 text-sm text-red-700" aria-label={`Delete ${k.title}`}>Delete</button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
