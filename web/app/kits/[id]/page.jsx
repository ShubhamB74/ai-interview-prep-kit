'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import KitBuilder from '../../../components/builder/KitBuilder';
import ProgressSteps from '../../../components/ProgressSteps';
import { useKit } from '../../../lib/useKit';

export default function KitPage() {
  const { id } = useParams();
  const router = useRouter();
  const onUnauthorized = useCallback(() => router.push('/'), [router]);
  const { rec, kit, saving, error, clearError, dispatch, regenerate } = useKit(id, { onUnauthorized });

  const back = <Link href="/" className="text-sm text-indigo-700 underline">← All kits</Link>;
  if (!rec) return <div className="space-y-3">{back}{error ? <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error.message}</p> : <p className="text-slate-500">Loading…</p>}</div>;

  return (
    <div className="space-y-4">
      {back}
      {rec.status === 'ready' && kit && (
        <KitBuilder rec={rec} kit={kit} saving={saving} error={error} onClearError={clearError} onEdit={dispatch} onRegenerate={regenerate} />
      )}
      {(rec.status === 'pending' || rec.status === 'running') && (
        <section aria-label="Generating" className="space-y-3 rounded border bg-white p-4">
          <h1 className="text-xl font-semibold">{rec.title}</h1>
          <p className="text-sm text-slate-600">Your kit is being generated. This page updates by itself.</p>
          <ProgressSteps progress={rec.progress} />
        </section>
      )}
      {rec.status === 'failed' && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-800">Generation failed{rec.error?.code ? ` (${rec.error.code})` : ''}: {rec.error?.message} Go back to the list to try again.</p>
      )}
    </div>
  );
}
