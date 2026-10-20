'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Mock interview attempts + report for one kit. Scores are computed by the server from the ticked checklist. */
export function useMock(kitId, { onUnauthorized } = {}) {
  const [data, setData] = useState(null); // { attempts, report }
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fail = useCallback((err) => {
    if (err.status === 401) onUnauthorized?.();
    else if (alive.current) setError(err.message);
  }, [onUnauthorized]);

  const load = useCallback(async () => {
    try { const d = await api(`/kits/${kitId}/mock`); if (alive.current) setData(d); } catch (err) { fail(err); }
  }, [kitId, fail]);
  useEffect(() => { load(); }, [load]);

  /** @returns the saved report, or undefined if saving failed (the error is shown and the attempt is kept by the caller). */
  const save = useCallback(async (body) => {
    setSaving(true); setError(null);
    try {
      const res = await api(`/kits/${kitId}/mock/attempts`, { method: 'POST', body });
      if (alive.current) setData((d) => ({ attempts: [res.attempt, ...(d?.attempts ?? [])].slice(0, 10), report: res.report }));
      return res.report;
    } catch (err) { fail(err); return undefined; } finally { if (alive.current) setSaving(false); }
  }, [kitId, fail]);

  const reset = useCallback(async () => {
    try { await api(`/kits/${kitId}/mock`, { method: 'DELETE' }); if (alive.current) setData({ attempts: [], report: { attempts: 0, latest: null, trend: [] } }); } catch (err) { fail(err); }
  }, [kitId, fail]);

  return { data, error, saving, clearError: () => setError(null), save, reset };
}
