'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn, inputCls } from './ui';

/**
 * Text that edits in place. Keyboard: Edit button -> field is focused; Ctrl/Cmd+Enter (or Enter for one-line fields)
 * saves, Escape cancels; focus returns to the Edit button. Saving is instant (the parent applies the change optimistically).
 */
export default function EditableField({ value, onSave, label, multiline = false, numeric = false, required = true, maxLength = 2000, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const [error, setError] = useState(null);
  const fieldRef = useRef(null);
  const editBtn = useRef(null);

  useEffect(() => { if (!editing) setDraft(String(value ?? '')); }, [value, editing]);
  useEffect(() => { if (editing) fieldRef.current?.focus(); }, [editing]);

  function finish(save) {
    if (save) {
      const v = draft.trim();
      if (required && v === '') return setError(`${label} can’t be empty`);
      if (numeric && !/^\d+$/.test(v)) return setError('Enter a whole number');
      if (v !== String(value ?? '')) onSave(numeric ? Number(v) : v);
    }
    setError(null);
    setEditing(false);
    setTimeout(() => editBtn.current?.focus(), 0);
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
  };

  if (!editing) {
    return (
      <div className={`flex items-start gap-2 ${className}`}>
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{String(value ?? '') || <span className="text-slate-400">Empty</span>}</div>
        <Btn ref={editBtn} aria-label={`Edit ${label}`} onClick={() => setEditing(true)} className="shrink-0">Edit</Btn>
      </div>
    );
  }
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div className={`space-y-1 ${className}`}>
      <Field
        ref={fieldRef} aria-label={label} className={inputCls} value={draft} maxLength={maxLength} rows={multiline ? 4 : undefined}
        inputMode={numeric ? 'numeric' : undefined} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => finish(true)}>Save</Btn>
        <Btn onClick={() => finish(false)}>Cancel</Btn>
        <span className="self-center text-xs text-slate-500">{multiline ? 'Ctrl+Enter to save, Esc to cancel' : 'Enter to save, Esc to cancel'}</span>
      </div>
    </div>
  );
}
