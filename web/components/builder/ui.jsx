'use client';
import { forwardRef, useState } from 'react';

export const CATEGORIES = ['technical', 'system-design', 'behavioural', 'company-fit'];
export const CATEGORY_LABEL = { technical: 'Technical', 'system-design': 'System design', behavioural: 'Behavioural', 'company-fit': 'Company fit' };
export const DIFFICULTY_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
export const inputCls = `w-full rounded border border-slate-300 px-2 py-1.5 text-sm ${focusRing}`;

export const Btn = forwardRef(function Btn({ children, variant = 'plain', className = '', ...rest }, ref) {
  const styles = {
    plain: 'border bg-white text-slate-700 hover:bg-slate-50',
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  }[variant];
  return (
    <button ref={ref} type="button" {...rest} className={`rounded px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${focusRing} ${className}`}>
      {children}
    </button>
  );
});

const BADGE = { edited: 'bg-amber-100 text-amber-800', user: 'bg-sky-100 text-sky-800', pinned: 'bg-violet-100 text-violet-800', template: 'bg-slate-200 text-slate-700', must: 'bg-rose-100 text-rose-800', nice: 'bg-slate-100 text-slate-600', review: 'bg-teal-100 text-teal-800' };
const BADGE_TEXT = { edited: 'edited', user: 'yours', pinned: 'pinned', template: 'template', must: 'must', nice: 'nice', review: 'review' };
export const Badge = ({ kind }) => <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[kind]}`}>{BADGE_TEXT[kind] ?? kind}</span>;

/** "Delete" that asks once, inline, without a modal (keeps keyboard flow simple). */
export function ConfirmDelete({ label, onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Btn variant="danger" aria-label={`Delete ${label}`} onClick={() => setAsking(true)}>Delete</Btn>;
  return (
    <span role="group" aria-label={`Confirm deleting ${label}`} className="inline-flex items-center gap-1">
      <span className="text-sm text-red-700">Delete?</span>
      <Btn variant="danger" onClick={onConfirm}>Yes</Btn>
      <Btn onClick={() => setAsking(false)} autoFocus>No</Btn>
    </span>
  );
}
