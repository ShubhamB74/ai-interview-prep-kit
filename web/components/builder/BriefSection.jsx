'use client';
import { useState } from 'react';
import EditableField from './EditableField';
import { Badge, Btn } from './ui';

/** Company brief (editable, regenerable) and the role's requirements with how many questions cover each. */
export default function BriefSection({ kit, regen, onEdit, onRegenerate }) {
  const [confirming, setConfirming] = useState(false);
  const brief = kit.company_brief;
  const busy = regen?.status === 'running';
  const coverage = new Map(kit.role.requirements.map((r) => [r.id, kit.questions.filter((q) => q.requirement_ids.includes(r.id)).length]));

  async function regenerate(force) {
    try { await onRegenerate({ section: 'brief', ...(force ? { force: true } : {}) }); setConfirming(false); }
    catch (err) { if (err.code === 'REGENERATE_WOULD_DISCARD_EDITS') setConfirming(true); }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="brief-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="brief-h" className="text-lg font-semibold">Company brief {brief.origin === 'edited' && <Badge kind="edited" />}</h2>
          <Btn onClick={() => regenerate(false)} disabled={busy}>{busy && regen.section === 'brief' ? 'Regenerating…' : 'Regenerate brief'}</Btn>
        </div>
        {confirming && (
          <div role="alertdialog" aria-label="Confirm regenerating the brief" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <p>You edited this brief. Regenerating replaces your changes with a fresh one from the company website.</p>
            <div className="mt-2 flex gap-2"><Btn variant="danger" onClick={() => regenerate(true)}>Replace my edits</Btn><Btn onClick={() => setConfirming(false)} autoFocus>Keep my version</Btn></div>
          </div>
        )}
        <div><h3 className="text-sm font-medium text-slate-500">Summary</h3><EditableField label="summary" multiline value={brief.summary} required={false} maxLength={1500} onSave={(v) => onEdit([{ op: 'update_brief', patch: { summary: v } }])} /></div>
        <div><h3 className="text-sm font-medium text-slate-500">What they do</h3><EditableField label="what they do" multiline value={brief.what_they_do} required={false} maxLength={1500} onSave={(v) => onEdit([{ op: 'update_brief', patch: { what_they_do: v } }])} /></div>
        {brief.sources.length > 0 && (
          <p className="text-sm text-slate-500">Sources: {brief.sources.map((u, i) => <span key={u}>{i > 0 && ', '}<a className="text-indigo-700 underline" href={u} target="_blank" rel="noreferrer noopener">{new URL(u).host + new URL(u).pathname}</a></span>)}</p>
        )}
        {kit.research?.hiring_process && (
          <p className="text-sm text-slate-500">
            Interview process: {kit.research.hiring_process.known ? `found (${kit.research.hiring_process.confidence}${kit.research.hiring_page ? `, ${kit.research.hiring_page}` : ''})` : 'nothing published that we could find'}.
          </p>
        )}
      </section>

      <section aria-labelledby="role-h" className="space-y-2">
        <h2 id="role-h" className="text-lg font-semibold">{kit.role.title || 'Role'}{kit.role.seniority && <span className="ml-2 text-sm font-normal text-slate-500">{kit.role.seniority}</span>}</h2>
        {kit.role.responsibilities.length > 0 && <ul className="list-disc pl-5 text-sm text-slate-700">{kit.role.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>}
        <h3 className="pt-2 text-sm font-medium text-slate-500">Requirements</h3>
        {kit.role.requirements.length === 0
          ? <p className="rounded border border-dashed p-4 text-sm text-slate-500">No requirements could be found in the job description, so this kit is intentionally thin.</p>
          : (
            <ul className="space-y-1">
              {kit.role.requirements.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border bg-white px-3 py-2 text-sm">
                  <Badge kind={r.priority} /><span className="min-w-0 flex-1">{r.text}</span>
                  <span className={coverage.get(r.id) === 0 ? 'font-medium text-red-700' : 'text-slate-500'}>{coverage.get(r.id) === 0 ? 'no questions' : `${coverage.get(r.id)} question${coverage.get(r.id) === 1 ? '' : 's'}`}</span>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
