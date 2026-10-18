'use client';
import { useState } from 'react';
import { newId } from '@prepkit/shared/kitOps';
import EditableField from './EditableField';
import { Badge, Btn, CATEGORIES, CATEGORY_LABEL, ConfirmDelete, DIFFICULTY_LABEL, focusRing, inputCls } from './ui';

function RequirementPicker({ requirements, selected, onChange, label }) {
  return (
    <details className="text-sm">
      <summary className={`cursor-pointer text-slate-600 ${focusRing}`}>{label}: {selected.length === 0 ? 'none' : `${selected.length} requirement${selected.length === 1 ? '' : 's'}`}</summary>
      <ul className="mt-1 space-y-1">
        {requirements.map((r) => (
          <li key={r.id}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={selected.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />
              <span>{r.text} <Badge kind={r.priority} /></span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}

function QuestionItem({ q, requirements, position, total, onEdit, onMove }) {
  const update = (patch) => onEdit([{ op: 'update_question', id: q.id, patch }]);
  return (
    <li className="space-y-2 rounded border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">#{position}</span>
        {q.origin === 'edited' && <Badge kind="edited" />}{q.origin === 'user' && <Badge kind="user" />}{q.pinned && <Badge kind="pinned" />}{q.template && <Badge kind="template" />}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <Btn aria-label={`Move question ${position} up`} disabled={position === 1} onClick={() => onMove(q, -1)}>↑</Btn>
          <Btn aria-label={`Move question ${position} down`} disabled={position === total} onClick={() => onMove(q, 1)}>↓</Btn>
          <Btn aria-pressed={Boolean(q.pinned)} title="Pinned questions survive regenerating this category" onClick={() => update({ pinned: !q.pinned })}>{q.pinned ? 'Unpin' : 'Pin'}</Btn>
          <ConfirmDelete label={`question ${position}`} onConfirm={() => onEdit([{ op: 'delete_question', id: q.id }])} />
        </span>
      </div>
      <EditableField label={`question ${position}`} multiline value={q.prompt} maxLength={1000} onSave={(v) => update({ prompt: v })} className="font-medium" />
      <details className="text-sm">
        <summary className={`cursor-pointer text-slate-600 ${focusRing}`}>Answer outline</summary>
        <EditableField label={`answer outline for question ${position}`} multiline required={false} value={q.answer_outline} maxLength={2000} onSave={(v) => update({ answer_outline: v })} className="mt-1 text-slate-700" />
      </details>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">Difficulty
          <select className={`${inputCls} w-auto`} value={q.difficulty} onChange={(e) => update({ difficulty: Number(e.target.value) })}>
            {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Category
          <select className={`${inputCls} w-auto`} value={q.category} onChange={(e) => update({ category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      <RequirementPicker label="Covers" requirements={requirements} selected={q.requirement_ids} onChange={(ids) => update({ requirement_ids: ids })} />
    </li>
  );
}

function AddQuestion({ category, requirements, onAdd }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [difficulty, setDifficulty] = useState(2);
  const [reqIds, setReqIds] = useState([]);
  if (!open) return <Btn onClick={() => setOpen(true)}>Add a {CATEGORY_LABEL[category].toLowerCase()} question</Btn>;
  const submit = (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onAdd({ id: newId('q'), category, prompt: prompt.trim(), difficulty, requirement_ids: reqIds });
    setPrompt(''); setReqIds([]); setOpen(false);
  };
  return (
    <form onSubmit={submit} className="space-y-2 rounded border border-indigo-200 bg-indigo-50 p-3" aria-label={`Add ${CATEGORY_LABEL[category]} question`}>
      <label className="block text-sm font-medium">Question<textarea className={inputCls} rows={3} value={prompt} maxLength={1000} onChange={(e) => setPrompt(e.target.value)} autoFocus required /></label>
      <label className="flex items-center gap-2 text-sm">Difficulty
        <select className={`${inputCls} w-auto`} value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>{[1, 2, 3].map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}</select>
      </label>
      <RequirementPicker label="Covers" requirements={requirements} selected={reqIds} onChange={setReqIds} />
      <div className="flex gap-2"><Btn variant="primary" type="submit">Add question</Btn><Btn onClick={() => setOpen(false)}>Cancel</Btn></div>
    </form>
  );
}

/** Questions grouped by category. Reorder with the arrows; move between categories with the Category select. */
export default function QuestionsSection({ kit, regen, onEdit, onRegenerate }) {
  const busy = regen?.status === 'running';
  const [announce, setAnnounce] = useState('');

  function move(q, dir) {
    const list = kit.questions.filter((x) => x.category === q.category);
    const i = list.findIndex((x) => x.id === q.id);
    const before = dir < 0 ? list[i - 1]?.id : list[i + 2]?.id ?? null; // insert before the neighbour above, or before the one after the next
    onEdit([{ op: 'move_question', id: q.id, category: q.category, before_id: before ?? null }]);
    setAnnounce(`Moved to position ${i + 1 + dir} of ${list.length}`);
  }

  return (
    <div className="space-y-8">
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {CATEGORIES.map((category) => {
        const list = kit.questions.filter((q) => q.category === category);
        const running = busy && regen.section === 'questions' && regen.category === category;
        return (
          <section key={category} aria-labelledby={`cat-${category}`} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`cat-${category}`} className="text-lg font-semibold">{CATEGORY_LABEL[category]} <span className="text-sm font-normal text-slate-500">({list.length})</span></h2>
              <Btn disabled={busy} title="Replaces only questions you have not edited, written or pinned" onClick={() => onRegenerate({ section: 'questions', category })}>{running ? 'Regenerating…' : 'Regenerate'}</Btn>
            </div>
            {list.length === 0 && <p className="rounded border border-dashed p-4 text-sm text-slate-500">No {CATEGORY_LABEL[category].toLowerCase()} questions yet.</p>}
            <ol className="space-y-2">
              {list.map((q, i) => <QuestionItem key={q.id} q={q} requirements={kit.role.requirements} position={i + 1} total={list.length} onEdit={onEdit} onMove={move} />)}
            </ol>
            <AddQuestion category={category} requirements={kit.role.requirements} onAdd={(question) => onEdit([{ op: 'add_question', question }])} />
          </section>
        );
      })}
    </div>
  );
}
