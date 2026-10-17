'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import ProgressSteps from './ProgressSteps';

const ACTIVE = new Set(['pending', 'running']);
const POLL_MS = 1500;

/**
 * One kit in the list. While it is generating it polls its own detail endpoint for status + progress, so the
 * rest of the page stays still. Failed kits show the reason and a Retry button.
 */
export default function KitCard({ kit: initial, onDelete, onAuthError }) {
  const [kit, setKit] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const { kit: k } = await api(`/kits/${initial.id}`);
      if (alive.current) setKit((prev) => ({ ...prev, ...k }));
    } catch (err) {
      if (err.status === 401) onAuthError(err);
      else if (err.status !== 404 && alive.current) setError(err.message);
    }
  }, [initial.id, onAuthError]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!ACTIVE.has(kit.status)) return undefined;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [kit.status, refresh]);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const { kit: k } = await api(`/kits/${kit.id}/retry`, { method: 'POST' });
      setKit((prev) => ({ ...prev, ...k }));
    } catch (err) {
      if (err.status === 401) onAuthError(err);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const active = ACTIVE.has(kit.status);
  const badge = { pending: 'bg-slate-100 text-slate-700', running: 'bg-indigo-100 text-indigo-800', ready: 'bg-emerald-100 text-emerald-800', failed: 'bg-red-100 text-red-800' }[kit.status];

  return (
    <li className="rounded border bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{kit.title}</p>
          <p className="truncate text-sm text-slate-500">{kit.company_url} · {kit.days} day{kit.days === 1 ? '' : 's'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge}`}>{kit.status === 'pending' ? 'queued' : kit.status}</span>
          <button onClick={() => onDelete(kit.id)} className="rounded border px-2 py-1 text-sm text-red-700" aria-label={`Delete ${kit.title}`}>Delete</button>
        </div>
      </div>

      {active && <div className="mt-3"><ProgressSteps progress={kit.progress} /></div>}

      {kit.status === 'failed' && (
        <div role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Generation failed{kit.error?.code ? ` (${kit.error.code})` : ''}</p>
          <p>{kit.error?.message ?? 'Something went wrong.'}</p>
          <button onClick={retry} disabled={busy} className="mt-2 rounded bg-red-700 px-3 py-1 text-white disabled:opacity-50">{busy ? 'Retrying…' : 'Try again'}</button>
        </div>
      )}

      {kit.status === 'ready' && kit.kit?.research?.gaps?.length > 0 && (
        <details className="mt-3 text-sm text-slate-600">
          <summary className="cursor-pointer">Ready — {kit.kit.research.gaps.length} note{kit.kit.research.gaps.length === 1 ? '' : 's'} about what couldn’t be found</summary>
          <ul className="mt-1 list-disc pl-5">{kit.kit.research.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </details>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
