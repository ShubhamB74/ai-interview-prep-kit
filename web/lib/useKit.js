'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOps } from '@prepkit/shared/kitOps';
import { api } from './api';

const POLL_MS = 2000;
const ACTIVE = new Set(['pending', 'running']);

/**
 * State for one kit in the builder.
 *  - `kit` is what the screen shows. Edits are applied to it IMMEDIATELY with the same rules the server uses
 *    (@prepkit/shared/kitOps), so typing and reordering never wait for the network.
 *  - Ops are sent to the server strictly in order. While any are queued or in flight, background polls are ignored
 *    (they would overwrite newer local edits); when the queue drains, the server's version replaces the local one,
 *    which picks up server-side effects such as the re-flowed schedule.
 *  - If the server rejects an edit, the queue is dropped, the error is shown and the server's version is reloaded.
 *  - A regeneration runs on the server; polling shows its progress and then the merged result.
 */
export function useKit(id, { onUnauthorized } = {}) {
  const [rec, setRec] = useState(null);
  const [kit, setKit] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const queue = useRef([]);
  const flushing = useRef(false);
  const latest = useRef(null);
  const alive = useRef(true);
  const idle = () => !flushing.current && queue.current.length === 0;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fail = useCallback((err) => {
    if (err.status === 401) onUnauthorized?.();
    else if (alive.current) setError({ code: err.code, message: err.message });
  }, [onUnauthorized]);

  const load = useCallback(async ({ force = false } = {}) => {
    try {
      const { kit: r } = await api(`/kits/${id}`);
      if (!alive.current) return;
      setRec(r);
      latest.current = r;
      if ((force || idle()) && r.kit) setKit(r.kit);
    } catch (err) {
      fail(err);
    }
  }, [id, fail]);

  useEffect(() => { load(); }, [load]);

  const needsPoll = rec && (ACTIVE.has(rec.status) || rec.regen?.status === 'running');
  useEffect(() => {
    if (!needsPoll) return undefined;
    const t = setInterval(() => load(), POLL_MS);
    return () => clearInterval(t);
  }, [needsPoll, load]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSaving(true);
    let failed = false;
    while (queue.current.length) {
      const ops = queue.current.shift();
      try {
        const { kit: r } = await api(`/kits/${id}/ops`, { method: 'POST', body: { ops } });
        latest.current = r;
        if (alive.current) setRec(r);
      } catch (err) {
        failed = true;
        queue.current = [];
        fail(err);
        break;
      }
    }
    flushing.current = false;
    if (!alive.current) return;
    setSaving(false);
    if (failed) await load({ force: true });
    else if (latest.current?.kit) setKit(latest.current.kit);
  }, [id, fail, load]);

  /** Apply ops locally right now, and send them in the background. */
  const dispatch = useCallback((ops) => {
    setKit((k) => {
      if (!k) return k;
      const copy = structuredClone(k);
      try { applyOps(copy, ops); } catch { /* the server is authoritative; it will correct us */ }
      return copy;
    });
    queue.current.push(ops);
    flush();
  }, [flush]);

  /** Schedule: instant. Brief / category: starts a background job (poll shows progress). Rejects with REGENERATE_WOULD_DISCARD_EDITS for confirmation. */
  const regenerate = useCallback(async (body) => {
    setError(null);
    try {
      const { kit: r } = await api(`/kits/${id}/regenerate`, { method: 'POST', body });
      latest.current = r;
      setRec(r);
      if (r.kit && idle()) setKit(r.kit);
      return r;
    } catch (err) {
      if (err.code === 'REGENERATE_WOULD_DISCARD_EDITS') throw err;
      fail(err);
      return undefined;
    }
  }, [id, fail]);

  return { rec, kit, saving, error, clearError: () => setError(null), dispatch, regenerate, reload: () => load({ force: true }) };
}
