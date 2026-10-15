'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Home() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    api('/health').then(() => setStatus('up')).catch(() => setStatus('down'));
  }, []);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">AI Interview Prep Kit</h1>
      <p className="text-slate-600">Phase 0 scaffold. API status: <strong>{status}</strong></p>
    </section>
  );
}
