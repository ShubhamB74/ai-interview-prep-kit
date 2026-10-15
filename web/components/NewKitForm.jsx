'use client';
import { useState } from 'react';
import { api } from '../lib/api';

/** Phase 1: creates the kit record. Generation + progress UI arrive in Phase 5. */
export default function NewKitForm({ onCreated }) {
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState(5);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api('/kits', { method: 'POST', body: { jd, company_url: companyUrl, days: Number(days) } });
      onCreated(res.kit, res.duplicate);
      if (!res.duplicate) { setJd(''); setCompanyUrl(''); }
    } catch (err) {
      setError(err.details?.map((d) => `${d.path}: ${d.message}`).join('; ') || err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border bg-white p-4">
      <h2 className="text-lg font-semibold">New kit</h2>
      <label className="block text-sm font-medium">
        Job description
        <textarea className={field} rows={6} required value={jd} onChange={(e) => setJd(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <label className="block text-sm font-medium">
          Company website
          <input className={field} type="url" required placeholder="https://example.com" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Days left
          <input className={field} type="number" min={1} max={90} required value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="rounded bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
        {busy ? 'Saving…' : 'Create kit'}
      </button>
    </form>
  );
}
