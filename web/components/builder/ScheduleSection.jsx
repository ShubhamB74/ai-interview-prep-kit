'use client';
import { useState } from 'react';
import EditableField from './EditableField';
import { Badge, Btn, CATEGORY_LABEL, DIFFICULTY_LABEL, inputCls } from './ui';

export default function ScheduleSection({ kit, onEdit, onRegenerate }) {
  const { days, days_available: total } = kit.schedule;
  const [nextDays, setNextDays] = useState(String(total));
  const [confirming, setConfirming] = useState(false);
  const byId = new Map(kit.questions.map((q) => [q.id, q]));
  const hasEdits = days.some((d) => d.origin === 'edited');
  const valid = /^\d+$/.test(nextDays) && Number(nextDays) >= 1 && Number(nextDays) <= 90;
  const totalMinutes = days.reduce((n, d) => n + d.minutes, 0);

  function rebuild() {
    if (hasEdits && !confirming) return setConfirming(true);
    setConfirming(false);
    onRegenerate({ section: 'schedule', days: Number(nextDays) });
  }

  return (
    <section aria-labelledby="sched-h" className="space-y-4">
      <h2 id="sched-h" className="text-lg font-semibold">Study schedule <span className="text-sm font-normal text-slate-500">({total} day{total === 1 ? '' : 's'}, {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m)</span></h2>
      <div className="flex flex-wrap items-end gap-2 rounded border bg-white p-3">
        <label className="text-sm font-medium">Days until the interview
          <input className={`${inputCls} w-24`} inputMode="numeric" value={nextDays} onChange={(e) => setNextDays(e.target.value)} aria-invalid={!valid} />
        </label>
        <Btn variant="primary" disabled={!valid} onClick={rebuild}>Rebuild schedule</Btn>
        <p className="text-xs text-slate-500">Rebuilds the whole plan from your current questions{hasEdits ? ' and replaces the days you edited' : ''}. Harder and must-have material comes first.</p>
        {confirming && (
          <div role="alertdialog" aria-label="Confirm rebuilding the schedule" className="w-full rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            You edited some days; rebuilding replaces those edits.
            <div className="mt-2 flex gap-2"><Btn variant="danger" onClick={rebuild}>Rebuild anyway</Btn><Btn onClick={() => setConfirming(false)} autoFocus>Cancel</Btn></div>
          </div>
        )}
      </div>
      <ol className="space-y-2">
        {days.map((d) => (
          <li key={d.day} className="space-y-2 rounded border bg-white p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <h3 className="font-semibold">Day {d.day}</h3>
              {d.type === 'review' && <Badge kind="review" />}{d.origin === 'edited' && <Badge kind="edited" />}
              <span className="ml-auto flex items-center gap-1 text-slate-600">
                <EditableField label={`minutes for day ${d.day}`} numeric value={d.minutes} onSave={(v) => onEdit([{ op: 'update_day', day: d.day, patch: { minutes: v } }])} className="w-32" /> min
              </span>
            </div>
            <EditableField label={`focus for day ${d.day}`} value={d.focus} maxLength={300} onSave={(v) => onEdit([{ op: 'update_day', day: d.day, patch: { focus: v } }])} />
            {d.question_ids.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                {d.question_ids.map((id) => { const q = byId.get(id); return q && <li key={id}>{q.prompt} <span className="text-xs text-slate-500">({CATEGORY_LABEL[q.category]}, {DIFFICULTY_LABEL[q.difficulty]})</span></li>; })}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
