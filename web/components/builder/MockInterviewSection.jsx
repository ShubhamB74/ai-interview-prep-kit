'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MINUTES_PER_QUESTION, planMock, splitOutline, WEAK_BELOW } from '@prepkit/shared/mock';
import { useMock } from '../../lib/useMock';
import { Badge, Btn, CATEGORY_LABEL, focusRing, inputCls } from './ui';

const pct = (x) => `${Math.round(x * 100)}%`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const BASIS_TEXT = {
  published: 'The rounds follow the interview process this company publishes.',
  reported: 'The rounds follow what candidates report about this company (unverified).',
  default: 'This company doesn’t publish its process, so this is a standard interview: technical, design, behavioural.',
};

export function Intro({ plan, attempts, onStart, onShowReport }) {
  if (plan.rounds.length === 0) {
    return <p className="rounded border border-dashed p-4 text-sm text-slate-500">This kit doesn’t have enough questions for a mock interview yet. Add or regenerate some in the Questions tab.</p>;
  }
  return (
    <section aria-labelledby="mock-h" className="space-y-4">
      <h2 id="mock-h" className="text-lg font-semibold">Mock interview</h2>
      <p className="text-sm text-slate-600">{BASIS_TEXT[plan.basis]} You answer in writing against a timer, then tick the points of the model answer you actually covered. Nothing is graded by AI: the score is yours, so be honest.</p>
      <ol className="space-y-2">
        {plan.rounds.map((r, i) => (
          <li key={r.id} className="rounded border bg-white p-3">
            <p className="font-medium">Round {i + 1}: {r.title} <span className="text-sm font-normal text-slate-500">· {r.question_ids.length} question{r.question_ids.length === 1 ? '' : 's'} · about {r.suggested_minutes} min</span></p>
            <p className="text-sm text-slate-600">{r.blurb}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-slate-500">{plan.total_questions} questions, about {plan.total_minutes} minutes.</p>
      <div className="flex flex-wrap gap-2">
        <Btn variant="primary" onClick={onStart}>Start mock interview</Btn>
        {attempts > 0 && <Btn onClick={onShowReport}>See my last result ({attempts} attempt{attempts === 1 ? '' : 's'})</Btn>}
      </div>
    </section>
  );
}

/** One run: for each planned question, answer under a timer, then self-score against the outline checklist. */
export function Runner({ kit, plan, onFinish, onCancel }) {
  const items = useMemo(() => plan.rounds.flatMap((r) => r.question_ids.map((qid) => ({ round: r, qid }))), [plan]);
  const byId = useMemo(() => new Map(kit.questions.map((q) => [q.id, q])), [kit.questions]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState('answer'); // 'answer' | 'review'
  const [text, setText] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [covered, setCovered] = useState([]);
  const [answers, setAnswers] = useState([]);
  const fieldRef = useRef(null);
  const nextRef = useRef(null);

  const item = items[idx];
  const q = item && byId.get(item.qid);
  const points = useMemo(() => splitOutline(q?.answer_outline), [q]);
  const suggested = q ? MINUTES_PER_QUESTION[q.difficulty] * 60 : 0;

  useEffect(() => { if (idx < items.length && !q) setIdx((i) => i + 1); }, [idx, items.length, q]); // deleted mid-run: skip
  useEffect(() => {
    if (phase !== 'answer' || !q) return undefined;
    const t = setInterval(() => setSeconds((s) => Math.min(3600, s + 1)), 1000);
    return () => clearInterval(t);
  }, [phase, q]);
  useEffect(() => { (phase === 'answer' ? fieldRef : nextRef).current?.focus(); }, [phase, idx]);

  const finish = (list, completed) => onFinish({
    completed, basis: plan.basis,
    rounds: plan.rounds.map((r) => ({ id: r.id, question_ids: r.question_ids })),
    answers: list,
  });
  const record = (extra) => ({ question_id: q.id, round_id: item.round.id, seconds, ...extra });
  const advance = (list) => {
    if (idx + 1 >= items.length) return finish(list, true);
    setIdx(idx + 1); setPhase('answer'); setText(''); setSeconds(0); setCovered([]);
  };

  const submit = () => {
    if (!text.trim()) return;
    setAnswers((a) => [...a, record({ answer_text: text.trim(), covered: [], skipped: false })]);
    setCovered(points.map(() => false));
    setPhase('review');
  };
  const skip = () => { const list = [...answers, record({ answer_text: '', covered: [], skipped: true })]; setAnswers(list); advance(list); };
  const next = () => {
    const list = answers.map((a, i) => (i === answers.length - 1 ? { ...a, covered } : a));
    setAnswers(list);
    advance(list);
  };
  const endNow = () => {
    const list = phase === 'review' ? answers.map((a, i) => (i === answers.length - 1 ? { ...a, covered } : a)) : answers;
    if (list.length === 0) onCancel(); else finish(list, false);
  };

  if (!q) return null;
  const overrun = phase === 'answer' && seconds > suggested;
  return (
    <section aria-label="Mock interview in progress" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>{item.round.title} · question {idx + 1} of {items.length}</span>
        <Btn onClick={endNow}>End interview now</Btn>
      </div>
      <div role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={idx} className="h-1.5 rounded bg-slate-200"><div className="h-1.5 rounded bg-indigo-600" style={{ width: `${(idx / items.length) * 100}%` }} /></div>

      <div className="space-y-3 rounded-lg border bg-white p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-slate-100 px-1.5 py-0.5">{CATEGORY_LABEL[q.category]}</span><span className={overrun ? 'font-medium text-red-700' : 'text-slate-500'} aria-label="Time on this question">{mmss(seconds)} / {mmss(suggested)} suggested</span></div>
        <p className="whitespace-pre-wrap text-lg font-medium">{q.prompt}</p>

        {phase === 'answer' ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium">Your answer
              <textarea ref={fieldRef} className={inputCls} rows={7} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} placeholder="Write the answer you would give out loud…" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="primary" disabled={!text.trim()} onClick={submit}>Submit answer <span className="text-xs opacity-80">(Ctrl+Enter)</span></Btn>
              <Btn onClick={skip}>Skip this question</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div><h3 className="text-xs font-medium uppercase text-slate-500">Your answer</h3><p className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{answers.at(-1)?.answer_text}</p></div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Which of these did your answer cover?</legend>
              {points.map((p, i) => (
                <label key={i} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={Boolean(covered[i])} onChange={(e) => setCovered((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
                  <span>{p}</span>
                </label>
              ))}
            </fieldset>
            <p className="text-sm text-slate-600" role="status">{covered.filter(Boolean).length} of {points.length} covered</p>
            <Btn ref={nextRef} variant="primary" onClick={next}>{idx + 1 >= items.length ? 'Finish interview' : 'Next question'}</Btn>
          </div>
        )}
      </div>
    </section>
  );
}

export function Report({ report, saving, onAgain, onBack, onReset }) {
  const L = report.latest;
  if (!L) return <p className="text-sm text-slate-500">No mock interviews yet.</p>;
  const verdict = L.overall >= 0.8 ? 'Strong' : L.overall >= WEAK_BELOW ? 'Solid, with gaps' : 'Needs work';
  return (
    <section aria-labelledby="rep-h" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 id="rep-h" className="text-lg font-semibold">Your result {!L.completed && <span className="text-sm font-normal text-slate-500">(ended early)</span>}</h2>
          <p className="text-3xl font-semibold" role="status">{pct(L.overall)} <span className="text-base font-normal text-slate-600">· {verdict}</span></p></div>
        <p className="text-sm text-slate-500">Time {mmss(L.seconds_used)} of {mmss(L.seconds_suggested)} suggested</p>
      </div>

      <div><h3 className="mb-1 text-sm font-medium text-slate-500">By round</h3>
        <ul className="space-y-1">{L.by_round.map((r) => (
          <li key={r.id} className="rounded border bg-white px-3 py-2 text-sm"><div className="flex justify-between"><span>{r.title} <span className="text-slate-500">({r.answered}/{r.planned} answered)</span></span><span>{pct(r.score)}</span></div>
            <div className="mt-1 h-1.5 rounded bg-slate-200" aria-hidden="true"><div className={`h-1.5 rounded ${r.score < WEAK_BELOW ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: pct(r.score) }} /></div></li>
        ))}</ul></div>

      <div><h3 className="mb-1 text-sm font-medium text-slate-500">Requirements, weakest first</h3>
        <ul className="space-y-1">{L.by_requirement.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border bg-white px-3 py-2 text-sm"><Badge kind={r.priority} /><span className="min-w-0 flex-1">{r.text}</span>
            <span className={r.score < WEAK_BELOW ? 'font-medium text-red-700' : 'text-slate-600'}>{pct(r.score)}{r.score < WEAK_BELOW && ' · revisit'}</span></li>
        ))}</ul>
        {L.unasked_musts.length > 0 && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">Not asked this time: {L.unasked_musts.map((r) => r.text).join('; ')}. Run another interview or practise these directly.</p>}
      </div>

      {L.weakest.length > 0 && <div><h3 className="mb-1 text-sm font-medium text-slate-500">Questions to redo</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">{L.weakest.map((w) => <li key={w.question_id}>{w.prompt} <span className="text-slate-500">({w.skipped ? 'skipped' : pct(w.score)})</span></li>)}</ul></div>}

      {report.trend.length > 1 && <p className="text-sm text-slate-600">Across attempts (oldest to newest): {report.trend.map((t) => pct(t.overall)).join(' → ')}</p>}
      <div className="flex flex-wrap gap-2"><Btn variant="primary" onClick={onAgain} disabled={saving}>Run another interview</Btn><Btn onClick={onBack}>Back</Btn><Btn variant="danger" onClick={onReset}>Delete all attempts</Btn></div>
    </section>
  );
}

export default function MockInterviewSection({ kit, kitId, onUnauthorized }) {
  const { data, error, saving, clearError, save, reset } = useMock(kitId, { onUnauthorized });
  const [view, setView] = useState('intro'); // intro | run | report
  const [report, setReport] = useState(null);
  const [pendingBody, setPendingBody] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const plan = useMemo(() => planMock(kit), [kit.questions, kit.research]); // eslint-disable-line react-hooks/exhaustive-deps
  const [runPlan, setRunPlan] = useState(plan);

  if (!data) return error ? <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p> : <p className="text-slate-500">Loading…</p>;

  async function finish(body) {
    setPendingBody(body);
    const rep = await save(body);
    if (rep) { setReport(rep); setPendingBody(null); setView('report'); }
  }

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="flex justify-between gap-3 rounded bg-red-50 p-3 text-sm text-red-800"><p>Couldn’t save your interview: {error}</p><Btn onClick={clearError}>Dismiss</Btn></div>}
      {pendingBody && !saving && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Your answers are still here. <Btn variant="primary" onClick={() => finish(pendingBody)}>Try saving again</Btn></div>}
      {confirmReset && (
        <div role="alertdialog" aria-label="Confirm deleting all attempts" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Delete all mock interview attempts for this kit?
          <div className="mt-2 flex gap-2"><Btn variant="danger" onClick={() => { reset(); setConfirmReset(false); setView('intro'); }}>Delete</Btn><Btn onClick={() => setConfirmReset(false)} autoFocus>Cancel</Btn></div></div>
      )}
      {view === 'intro' && <Intro plan={plan} attempts={data.report.attempts} onStart={() => { setRunPlan(plan); setView('run'); }} onShowReport={() => { setReport(data.report); setView('report'); }} />}
      {view === 'run' && <Runner kit={kit} plan={runPlan} onFinish={finish} onCancel={() => setView('intro')} />}
      {view === 'report' && report && <Report report={report} saving={saving} onAgain={() => { setRunPlan(plan); setView('run'); }} onBack={() => setView('intro')} onReset={() => setConfirmReset(true)} />}
    </div>
  );
}
