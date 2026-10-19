'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '@prepkit/shared/kitOps';
import { nextState } from '@prepkit/shared/leitner';
import { api } from './api';

/**
 * Practice progress for one kit. Ratings update the screen at once (same Leitner rule as the server), are sent one at a time
 * in order with an idempotency id, and the server's answer (which owns the clock) replaces the local guess.
 * If a rating cannot be saved, the error is shown and progress is reloaded so the screen never shows something the server lacks.
 */
export function usePractice(kitId, { onUnauthorized } = {}) {
  const [progress, setProgress] = useState(null); // { cards, interview_at, server_time }
  const [error, setError] = useState(null);
  const chain = useRef(Promise.resolve());
  const alive = useRef(true);
  const interviewAt = useRef(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fail = useCallback((err) => {
    if (err.status === 401) onUnauthorized?.();
    else if (alive.current) setError(err.message);
  }, [onUnauthorized]);

  const load = useCallback(async () => {
    try {
      const { practice } = await api(`/kits/${kitId}/practice`);
      if (!alive.current) return;
      interviewAt.current = practice.interview_at ? Date.parse(practice.interview_at) : null;
      setProgress(practice);
    } catch (err) { fail(err); }
  }, [kitId, fail]);

  useEffect(() => { load(); }, [load]);

  const review = useCallback((cardId, confidence) => {
    const reviewId = newId('rv');
    setProgress((p) => p && { ...p, cards: { ...p.cards, [cardId]: nextState(p.cards[cardId], confidence, { now: Date.now(), interviewAt: interviewAt.current, reviewId }) } });
    chain.current = chain.current.then(async () => {
      try {
        const { state } = await api(`/kits/${kitId}/practice/reviews`, { method: 'POST', body: { card_id: cardId, confidence, review_id: reviewId } });
        if (alive.current) setProgress((p) => p && { ...p, cards: { ...p.cards, [cardId]: state } });
      } catch (err) {
        fail(err);
        await load(); // drop the local guess
      }
    });
  }, [kitId, fail, load]);

  const reset = useCallback(async () => {
    try {
      await api(`/kits/${kitId}/practice`, { method: 'DELETE' });
      if (alive.current) setProgress((p) => p && { ...p, cards: {} });
    } catch (err) { fail(err); }
  }, [kitId, fail]);

  return { progress, error, clearError: () => setError(null), review, reset };
}
