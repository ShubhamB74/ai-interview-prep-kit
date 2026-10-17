const LABELS = {
  extract_requirements: 'Reading the job description',
  research: 'Researching the company',
  hiring_process: 'Reading the hiring process',
  company_brief: 'Writing the company brief',
  flashcards: 'Making flashcards',
  coverage: 'Checking every requirement has a question',
  schedule: 'Building the study schedule',
};
const label = (step) => LABELS[step] ?? (step.startsWith('questions:') ? `Questions: ${step.slice('questions:'.length)}` : step);
const ICON = { running: '…', done: '✓', failed: '✕', skipped: '–' };
const STYLE = { running: 'text-indigo-700', done: 'text-emerald-700', failed: 'text-red-700', skipped: 'text-slate-500' };

/** Live list of generation steps. `progress` comes from GET /kits/:id, already ordered. */
export default function ProgressSteps({ progress }) {
  if (!progress?.length) return <p className="text-sm text-slate-500">Waiting to start…</p>;
  return (
    <ol className="space-y-1 text-sm" aria-live="polite" aria-label="Generation progress">
      {progress.map((p) => (
        <li key={p.step} className={`flex gap-2 ${STYLE[p.status] ?? ''}`}>
          <span aria-hidden="true" className="w-4 text-center font-semibold">{ICON[p.status] ?? '•'}</span>
          <span>
            {label(p.step)}
            <span className="sr-only"> ({p.status})</span>
            {p.detail && <span className="text-slate-500"> — {p.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
