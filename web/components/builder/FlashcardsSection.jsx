'use client';
import { useState } from 'react';
import { newId } from '@prepkit/shared/kitOps';
import EditableField from './EditableField';
import { Badge, Btn, ConfirmDelete, inputCls } from './ui';

export default function FlashcardsSection({ kit, onEdit }) {
  const cards = kit.flashcards;
  const [open, setOpen] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  const move = (i, dir) => onEdit([{ op: 'move_flashcard', id: cards[i].id, before_id: dir < 0 ? cards[i - 1]?.id : cards[i + 2]?.id ?? null }]);
  const add = (e) => {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    onEdit([{ op: 'add_flashcard', flashcard: { id: newId('f'), front: front.trim(), back: back.trim() } }]);
    setFront(''); setBack(''); setOpen(false);
  };

  return (
    <section aria-labelledby="cards-h" className="space-y-3">
      <h2 id="cards-h" className="text-lg font-semibold">Flashcards <span className="text-sm font-normal text-slate-500">({cards.length})</span></h2>
      {cards.length === 0 && <p className="rounded border border-dashed p-4 text-sm text-slate-500">No flashcards yet. Add your own below.</p>}
      <ol className="space-y-2">
        {cards.map((c, i) => (
          <li key={c.id} className="space-y-2 rounded border bg-white p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">#{i + 1}</span>
              {c.origin === 'edited' && <Badge kind="edited" />}{c.origin === 'user' && <Badge kind="user" />}{c.pinned && <Badge kind="pinned" />}
              <span className="ml-auto flex flex-wrap gap-1">
                <Btn aria-label={`Move card ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Btn>
                <Btn aria-label={`Move card ${i + 1} down`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>↓</Btn>
                <Btn aria-pressed={Boolean(c.pinned)} onClick={() => onEdit([{ op: 'update_flashcard', id: c.id, patch: { pinned: !c.pinned } }])}>{c.pinned ? 'Unpin' : 'Pin'}</Btn>
                <ConfirmDelete label={`card ${i + 1}`} onConfirm={() => onEdit([{ op: 'delete_flashcard', id: c.id }])} />
              </span>
            </div>
            <div><h3 className="text-xs font-medium uppercase text-slate-500">Front</h3><EditableField label={`front of card ${i + 1}`} value={c.front} maxLength={300} multiline onSave={(v) => onEdit([{ op: 'update_flashcard', id: c.id, patch: { front: v } }])} className="font-medium" /></div>
            <div><h3 className="text-xs font-medium uppercase text-slate-500">Back</h3><EditableField label={`back of card ${i + 1}`} value={c.back} maxLength={600} multiline onSave={(v) => onEdit([{ op: 'update_flashcard', id: c.id, patch: { back: v } }])} /></div>
          </li>
        ))}
      </ol>
      {open ? (
        <form onSubmit={add} className="space-y-2 rounded border border-indigo-200 bg-indigo-50 p-3" aria-label="Add flashcard">
          <label className="block text-sm font-medium">Front<input className={inputCls} value={front} maxLength={300} onChange={(e) => setFront(e.target.value)} autoFocus required /></label>
          <label className="block text-sm font-medium">Back<textarea className={inputCls} rows={3} value={back} maxLength={600} onChange={(e) => setBack(e.target.value)} required /></label>
          <div className="flex gap-2"><Btn variant="primary" type="submit">Add flashcard</Btn><Btn onClick={() => setOpen(false)}>Cancel</Btn></div>
        </form>
      ) : <Btn onClick={() => setOpen(true)}>Add a flashcard</Btn>}
    </section>
  );
}
