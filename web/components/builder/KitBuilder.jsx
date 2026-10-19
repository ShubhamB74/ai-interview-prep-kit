'use client';
import { useRef, useState } from 'react';
import BriefSection from './BriefSection';
import FlashcardsSection from './FlashcardsSection';
import PracticeSection from './PracticeSection';
import QuestionsSection from './QuestionsSection';
import ScheduleSection from './ScheduleSection';
import { Btn, CATEGORY_LABEL, focusRing } from './ui';

const TABS = [['overview', 'Overview'], ['questions', 'Questions'], ['flashcards', 'Flashcards'], ['practice', 'Practice'], ['schedule', 'Schedule']];

/** Roving-tabindex tablist: Left/Right/Home/End move between tabs, as screen-reader users expect. */
function Tabs({ active, onChange, counts }) {
  const refs = useRef({});
  const onKeyDown = (e) => {
    const i = TABS.findIndex(([k]) => k === active);
    const next = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(TABS[next][0]);
    refs.current[TABS[next][0]]?.focus();
  };
  return (
    <div role="tablist" aria-label="Kit sections" className="flex gap-1 overflow-x-auto border-b" onKeyDown={onKeyDown}>
      {TABS.map(([key, label]) => (
        <button
          key={key} ref={(el) => { refs.current[key] = el; }} role="tab" id={`tab-${key}`} aria-selected={active === key} aria-controls={`panel-${key}`}
          tabIndex={active === key ? 0 : -1} onClick={() => onChange(key)}
          className={`whitespace-nowrap rounded-t px-3 py-2 text-sm font-medium ${focusRing} ${active === key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {label}{counts[key] !== undefined && <span className="ml-1 text-xs text-slate-500">({counts[key]})</span>}
        </button>
      ))}
    </div>
  );
}

export default function KitBuilder({ rec, kit, saving, error, onClearError, onEdit, onRegenerate }) {
  const [tab, setTab] = useState('overview');
  const [practiceOpened, setPracticeOpened] = useState(false);
  const select = (key) => { if (key === 'practice') setPracticeOpened(true); setTab(key); };
  const regen = rec.regen;
  const uncoveredMust = kit.role.requirements.filter((r) => r.priority === 'must' && !kit.questions.some((q) => q.requirement_ids.includes(r.id)));
  const gaps = kit.research?.gaps ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{kit.role.title || rec.title}</h1>
          <p className="truncate text-sm text-slate-500">{kit.source.company} · {kit.schedule.days_available} day{kit.schedule.days_available === 1 ? '' : 's'}</p>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-slate-500">{saving ? 'Saving…' : 'All changes saved'}</p>
      </header>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded bg-red-50 p-3 text-sm text-red-800">
          <p><strong>That change could not be saved{error.code ? ` (${error.code})` : ''}.</strong> {error.message} The kit was reloaded from the server.</p>
          <Btn onClick={onClearError}>Dismiss</Btn>
        </div>
      )}
      {regen?.status === 'running' && (
        <p role="status" className="rounded bg-indigo-50 p-3 text-sm text-indigo-800">
          Regenerating {regen.section === 'brief' ? 'the company brief' : `${CATEGORY_LABEL[regen.category]?.toLowerCase()} questions`}… You can keep editing: anything you edited, wrote or pinned is kept.
        </p>
      )}
      {regen?.status === 'failed' && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">
          Regenerating {regen.section === 'brief' ? 'the brief' : `${CATEGORY_LABEL[regen.category]?.toLowerCase()} questions`} failed ({regen.error?.code}): {regen.error?.message} Nothing was changed. Try again from its section.
        </p>
      )}
      {uncoveredMust.length > 0 && (
        <div role="note" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{uncoveredMust.length} must-have requirement{uncoveredMust.length === 1 ? ' has' : 's have'} no question:</p>
          <ul className="list-disc pl-5">{uncoveredMust.map((r) => <li key={r.id}>{r.text}</li>)}</ul>
        </div>
      )}
      {gaps.length > 0 && (
        <details className="text-sm text-slate-600">
          <summary className={`cursor-pointer ${focusRing}`}>{gaps.length} note{gaps.length === 1 ? '' : 's'} about what couldn’t be found</summary>
          <ul className="mt-1 list-disc pl-5">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </details>
      )}

      <Tabs active={tab} onChange={select} counts={{ questions: kit.questions.length, flashcards: kit.flashcards.length, schedule: kit.schedule.days.length }} />
      {tab !== 'practice' && (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className={focusRing}>
          {tab === 'overview' && <BriefSection kit={kit} regen={regen} onEdit={onEdit} onRegenerate={onRegenerate} />}
          {tab === 'questions' && <QuestionsSection kit={kit} regen={regen} onEdit={onEdit} onRegenerate={onRegenerate} />}
          {tab === 'flashcards' && <FlashcardsSection kit={kit} onEdit={onEdit} />}
          {tab === 'schedule' && <ScheduleSection kit={kit} onEdit={onEdit} onRegenerate={onRegenerate} />}
        </div>
      )}
      {/* Mounted once opened and then only hidden, so a session in progress survives switching tabs. */}
      {practiceOpened && (
        <div role="tabpanel" id="panel-practice" aria-labelledby="tab-practice" tabIndex={0} hidden={tab !== 'practice'} className={focusRing}>
          <PracticeSection kit={kit} kitId={rec.id} onGoToCards={() => select('flashcards')} />
        </div>
      )}
    </div>
  );
}
