'use client';
import { useState } from 'react';
import { parseCasesFile } from '@prepkit/shared/parseCases';
import { api } from '../lib/api';

const field = 'w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const ROW_TEXT = { created: 'Started', duplicate: 'You already have this kit', invalid: 'Skipped (invalid)', rejected: 'Not started' };

/** Create one kit by pasting, or several roles at once by uploading a JSON/CSV file of description + company pairs. */
export default function NewKitForm({ onCreated, onBatch }) {
  const [mode, setMode] = useState('paste');
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState(5);
  const [parsed, setParsed] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const fail = (err) => setError(err.details?.map((d) => `${d.path}: ${d.message}`).join('; ') || err.message);

  async function submitPaste(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api('/kits', { method: 'POST', body: { jd, company_url: companyUrl, days: Number(days) } });
      onCreated(res.kit, res.duplicate);
      if (!res.duplicate) { setJd(''); setCompanyUrl(''); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    setResults(null); setError(null); setParsed(null);
    if (!file) return;
    if (file.size > 2_000_000) return setError('That file is too large (2 MB max).');
    setParsed(parseCasesFile(await file.text(), file.name));
  }

  async function submitUpload(e) {
    e.preventDefault();
    if (!parsed?.items.length) return;
    setBusy(true); setError(null);
    try {
      const { results: r } = await api('/kits/batch', { method: 'POST', body: { days: Number(days), items: parsed.items.slice(0, 10) } });
      setResults(r);
      onBatch();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  const tab = (key, label) => (
    <button type="button" role="tab" aria-selected={mode === key} onClick={() => { setMode(key); setError(null); }}
      className={`rounded-t px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${mode === key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600'}`}>{label}</button>
  );
  const daysField = (
    <label className="block text-sm font-medium">Days left
      <input className={field} type="number" min={1} max={90} required value={days} onChange={(e) => setDays(e.target.value)} />
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div role="tablist" aria-label="How to add roles" className="flex gap-1 border-b">{tab('paste', 'Paste one role')}{tab('upload', 'Upload several')}</div>

      {mode === 'paste' ? (
        <form onSubmit={submitPaste} className="space-y-3">
          <label className="block text-sm font-medium">Job description
            <textarea className={field} rows={6} required value={jd} onChange={(e) => setJd(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label className="block text-sm font-medium">Company website
              <input className={field} type="url" required placeholder="https://example.com" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} />
            </label>
            {daysField}
          </div>
          <button disabled={busy} className="rounded bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Create kit'}</button>
        </form>
      ) : (
        <form onSubmit={submitUpload} className="space-y-3">
          <p className="text-sm text-slate-600">Upload a <strong>.json</strong> file (a list of <code>{'{ "jd": "...", "company_url": "https://..." }'}</code>) or a <strong>.csv</strong> with columns <code>jd,company_url</code>. Up to 10 roles.</p>
          <label className="block text-sm font-medium">File
            <input className={field} type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} />
          </label>
          {parsed && (
            <div className="text-sm" role="status">
              <p>{parsed.items.length} role{parsed.items.length === 1 ? '' : 's'} found{parsed.items.length > 10 ? ' (only the first 10 will be used)' : ''}.</p>
              {parsed.errors.length > 0 && <ul className="list-disc pl-5 text-amber-800">{parsed.errors.slice(0, 5).map((m) => <li key={m}>{m}</li>)}</ul>}
            </div>
          )}
          <div className="max-w-[8rem]">{daysField}</div>
          <button disabled={busy || !parsed?.items.length} className="rounded bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? 'Starting…' : 'Create kits'}</button>
          {results && (
            <ul className="space-y-1 text-sm" aria-label="Upload results">
              {results.map((r) => <li key={r.index} className={r.status === 'created' ? 'text-emerald-700' : 'text-amber-800'}>Role {r.index + 1}: {ROW_TEXT[r.status]}{r.error ? ` — ${r.error.message}` : ''}{r.errors ? ` — ${r.errors.join('; ')}` : ''}</li>)}
            </ul>
          )}
        </form>
      )}
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
