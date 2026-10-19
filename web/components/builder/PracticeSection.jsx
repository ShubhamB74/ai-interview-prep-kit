'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildQueue, summarize } from '@prepkit/shared/leitner';
import { usePractice } from '../../lib/usePractice';
import { Badge, Btn, focusRing } from './ui';

const RATINGS = [
  { value: 1, label: "Didn't know", cls: 'border-red-300 text-red-800 hover:bg-red-50' },
  { value: 2, label: 'Shaky', cls: 'border-amber-300 text-amber-800 hover:bg-amber-50' },
  { value: 3, label: 'Knew it', cls: 'border-emerald-300 text-emerald-800 hover:bg-emerald-50' },
];
const MAX_REQUEUES = 2;

export function formatIn(iso, now) {
  const ms = Date.parse(iso) - now;
  if (ms <= 60_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  return h < 36 ? `in ${h} hour${h === 1 ? '' : 's'}` : `in ${Math.round(h / 24)} days`;
}

/** One practice run. Space/Enter reveals; 1, 2, 3 rate. Cards rated "Didn't know" come back later in the same run (up to twice). */
export function Session({ queueIds, cardsById, requirements, onRate, onExit, onAgain }) {
  const [queue, setQueue] = useState(queueIds);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState({ 1: 0, 2: 0, 3: 0 });
  const requeues = useRef({});
  const revealBtn = useRef(null);
  const firstRating = useRef(null);
  const done = pos >= queue.length;
  const card = done ? null : cardsById.get(queue[pos]);

  useEffect(() => { if (!done && !card) setPos((p) => p + 1); }, [done, card]); // the card was deleted mid-run: skip it
  useEffect(() => { (revealed ? firstRating : revealBtn).current?.focus(); }, [revealed, pos]);

  const rate = (value) => {
    if (!card) return;
    onRate(card.id, value);
    setTally((t) => ({ ...t, [value]: t[value] + 1 }));
    if (value === 1 && (requeues.current[card.id] ?? 0) < MAX_REQUEUES) {
      requeues.current[card.id] = (requeues.current[card.id] ?? 0) + 1;
      setQueue((q) => [...q, card.id]);
    }
    setRevealed(false);
    setPos((p) => p + 1);
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter') && tag !== 'BUTTON') { e.preventDefault(); setRevealed(true); }
      else if (revealed && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); rate(Number(e.key)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (done) {
    const total = tally[1] + tally[2] + tally[3];
    return (
      <section aria-labelledby="done-h" className="space-y-3 rounded border bg-white p-4">
        <h2 id="done-h" className="text-lg font-semibold">Session complete</h2>
        <p role="status">{total} rating{total === 1 ? '' : 's'}: {tally[3]} knew it, {tally[2]} shaky, {tally[1]} didn’t know. Cards you missed will come back sooner.</p>
        <div className="flex gap-2"><Btn variant="primary" onClick={onAgain}>Study again, weakest first</Btn><Btn onClick={onExit}>Back to overview</Btn></div>
      </section>
    );
  }
  if (!card) return null;
  const covers = requirements.filter((r) => card.requirement_ids?.includes(r.id));
  return (
    <section aria-label="Practice session" className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
        <span>Card {pos + 1} of {queue.length}</span>
        <Btn onClick={onExit}>End session</Btn>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={pos} aria-label="Session progress" className="h-1.5 rounded bg-slate-200"><div className="h-1.5 rounded bg-indigo-600" style={{ width: `${(pos / queue.length) * 100}%` }} /></div>
      <div className="space-y-3 rounded-lg border bg-white p-5">
        <p className="whitespace-pre-wrap text-lg font-medium">{card.front}</p>
        {covers.length > 0 && <p className="text-xs text-slate-500">Covers: {covers.map((r) => r.text).join('; ')}</p>}
        {!revealed ? (
          <Btn ref={revealBtn} variant="primary" onClick={() => setRevealed(true)}>Show answer <span className="text-xs opacity-80">(Space)</span></Btn>
        ) : (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded bg-slate-50 p-3" aria-live="polite"><span className="sr-only">Answer: </span>{card.back}</p>
            <div role="group" aria-label="How confident were you?" className="flex flex-wrap gap-2">
              {RATINGS.map((r, i) => (
                <button key={r.value} ref={i === 0 ? firstRating : undefined} type="button" onClick={() => rate(r.value)} className={`rounded border bg-white px-3 py-1.5 text-sm font-medium ${r.cls} ${focusRing}`}>
                  {r.label} <span className="text-xs opacity-70">({r.value})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Numbers, session buttons, per-requirement coverage and weak spots. */
export function Overview({ summary, now, onStart, onReset, onGoToCards }) {
  const caughtUp = summary.reviewed > 0 && summary.due_now === 0;
  return (
    <div className="space-y-6">
      <section aria-labelledby="prac-h" className="space-y-3">
        <h2 id="prac-h" className="text-lg font-semibold">Practice</h2>
        {summary.total === 0 ? (
          <p className="rounded border border-dashed p-4 text-sm text-slate-500">This kit has no flashcards to practise yet. Add some in the Flashcards tab.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Due now', summary.due_now], ['New', summary.unseen], ['Reviewed', `${summary.reviewed}/${summary.total}`], ['Confident', summary.confident]].map(([k, v]) => (
                <div key={k} className="rounded border bg-white p-3"><dt className="text-xs uppercase text-slate-500">{k}</dt><dd className="text-2xl font-semibold">{v}</dd></div>
              ))}
            </dl>
            {summary.days_left !== null && <p className="text-sm text-slate-600">{summary.days_left === 0 ? 'Your interview is today or has passed.' : `About ${summary.days_left} day${summary.days_left === 1 ? '' : 's'} until your interview.`} Review intervals shrink as it gets closer.</p>}
            {caughtUp && <p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">You’re caught up.{summary.next_due_at && ` Next review ${formatIn(summary.next_due_at, now)}.`} You can still study everything.</p>}
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" disabled={summary.due_now === 0} onClick={() => onStart('due')}>Start session ({summary.due_now} card{summary.due_now === 1 ? '' : 's'}, weakest first)</Btn>
              <Btn onClick={() => onStart('all')}>Study everything, weakest first</Btn>
            </div>
          </>
        )}
      </section>

      {summary.weakest.length > 0 && (
        <section aria-labelledby="weak-h" className="space-y-2">
          <h2 id="weak-h" className="text-lg font-semibold">Weak spots</h2>
          <ul className="space-y-1">{summary.weakest.map((w) => <li key={w.id} className="flex items-center justify-between gap-2 rounded border bg-white px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{w.front}</span><span className="text-xs text-slate-500">box {w.box}</span></li>)}</ul>
        </section>
      )}

      <section aria-labelledby="cov-h" className="space-y-2">
        <h2 id="cov-h" className="text-lg font-semibold">What you’ve covered</h2>
        {summary.by_requirement.length === 0 && <p className="text-sm text-slate-500">No requirements to cover.</p>}
        <ul className="space-y-1">
          {summary.by_requirement.map((r) => (
            <li key={r.id} className="space-y-1 rounded border bg-white px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Badge kind={r.priority} /><span className="min-w-0 flex-1">{r.text}</span>
                {r.no_cards ? <span className="text-amber-800">No flashcards <button type="button" onClick={onGoToCards} className={`underline ${focusRing}`}>add one</button></span>
                  : <span className={r.reviewed === 0 ? 'text-red-700' : 'text-slate-600'}>{r.reviewed === 0 ? 'Not started' : `${r.reviewed}/${r.cards} reviewed`}{r.confident > 0 && `, ${r.confident} confident`}</span>}
              </div>
              {!r.no_cards && <div className="h-1.5 rounded bg-slate-200" aria-hidden="true"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${(r.reviewed / r.cards) * 100}%` }} /></div>}
            </li>
          ))}
        </ul>
      </section>

      {summary.reviewed > 0 && <div><Btn variant="danger" onClick={onReset}>Reset practice progress</Btn></div>}
    </div>
  );
}

export default function PracticeSection({ kit, kitId, onGoToCards, onUnauthorized }) {
  const { progress, error, clearError, review, reset } = usePractice(kitId, { onUnauthorized });
  const [session, setSession] = useState(null); // { ids, mode, key }
  const [confirmReset, setConfirmReset] = useState(false);
  const now = Date.now();
  const cardsById = useMemo(() => new Map(kit.flashcards.map((c) => [c.id, c])), [kit.flashcards]);
  const interviewAt = progress?.interview_at ? Date.parse(progress.interview_at) : null;

  if (!progress) return error ? <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p> : <p className="text-slate-500">Loading practice…</p>;
  const summary = summarize({ flashcards: kit.flashcards, requirements: kit.role.requirements, progress, now, interviewAt });
  const start = (mode) => setSession({ mode, key: Date.now(), ids: buildQueue({ flashcards: kit.flashcards, requirements: kit.role.requirements, progress, now: Date.now(), mode }) });

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="flex justify-between gap-3 rounded bg-red-50 p-3 text-sm text-red-800"><p>Your last rating could not be saved: {error} Progress was reloaded.</p><Btn onClick={clearError}>Dismiss</Btn></div>}
      {confirmReset && (
        <div role="alertdialog" aria-label="Confirm resetting practice progress" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Reset all practice progress for this kit? Every card goes back to “new”.
          <div className="mt-2 flex gap-2"><Btn variant="danger" onClick={() => { reset(); setConfirmReset(false); }}>Reset</Btn><Btn onClick={() => setConfirmReset(false)} autoFocus>Cancel</Btn></div>
        </div>
      )}
      {session
        ? (session.ids.length === 0
          ? <p role="status" className="rounded border border-dashed p-4 text-sm text-slate-600">Nothing to practise right now. <Btn onClick={() => setSession(null)}>Back</Btn></p>
          : <Session key={session.key} queueIds={session.ids} cardsById={cardsById} requirements={kit.role.requirements} onRate={review} onExit={() => setSession(null)} onAgain={() => start('all')} />)
        : <Overview summary={summary} now={now} onStart={start} onReset={() => setConfirmReset(true)} onGoToCards={onGoToCards} />}
    </div>
  );
}
