import { z } from 'zod';
import { MAX_DAYS } from './requests.js';

const CATEGORY = z.enum(['technical', 'behavioural', 'system-design', 'company-fit']);
const qId = z.string().regex(/^q-[a-z0-9]{4,16}$/, 'new question ids look like q-abc123');
const fId = z.string().regex(/^f-[a-z0-9]{4,16}$/, 'new flashcard ids look like f-abc123');
const anyId = z.string().min(1).max(40);
const reqIds = z.array(z.string().min(1).max(40)).max(20);
const text = (max) => z.string().trim().min(1).max(max);
const atLeastOne = (o) => Object.keys(o).length > 0;

const Op = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('update_question'), id: anyId,
    patch: z.object({
      prompt: text(1000), answer_outline: z.string().trim().max(2000), difficulty: z.number().int().min(1).max(3),
      category: CATEGORY, requirement_ids: reqIds, pinned: z.boolean(),
    }).partial().refine(atLeastOne, 'patch is empty'),
  }),
  z.object({
    op: z.literal('add_question'),
    question: z.object({
      id: qId, category: CATEGORY, prompt: text(1000), answer_outline: z.string().trim().max(2000).optional(),
      difficulty: z.number().int().min(1).max(3).optional(), requirement_ids: reqIds.optional(), before_id: anyId.optional(),
    }),
  }),
  z.object({ op: z.literal('delete_question'), id: anyId }),
  z.object({ op: z.literal('move_question'), id: anyId, category: CATEGORY, before_id: anyId.nullish() }),
  z.object({
    op: z.literal('update_flashcard'), id: anyId,
    patch: z.object({ front: text(300), back: text(600), requirement_ids: reqIds, pinned: z.boolean() }).partial().refine(atLeastOne, 'patch is empty'),
  }),
  z.object({
    op: z.literal('add_flashcard'),
    flashcard: z.object({ id: fId, front: text(300), back: text(600), requirement_ids: reqIds.optional(), before_id: anyId.optional() }),
  }),
  z.object({ op: z.literal('delete_flashcard'), id: anyId }),
  z.object({ op: z.literal('move_flashcard'), id: anyId, before_id: anyId.nullish() }),
  z.object({
    op: z.literal('update_brief'),
    patch: z.object({ summary: z.string().trim().max(1500), what_they_do: z.string().trim().max(1500) }).partial().refine(atLeastOne, 'patch is empty'),
  }),
  z.object({
    op: z.literal('update_day'), day: z.number().int().min(1),
    patch: z.object({ focus: text(300), minutes: z.number().int().min(0).max(1440) }).partial().refine(atLeastOne, 'patch is empty'),
  }),
]);

export const MAX_OPS = 50;
export const opsBody = z.object({ ops: z.array(Op).min(1).max(MAX_OPS) });

export const regenerateBody = z.discriminatedUnion('section', [
  z.object({ section: z.literal('schedule'), days: z.number().int().min(1).max(MAX_DAYS).optional() }),
  z.object({ section: z.literal('brief'), force: z.boolean().optional() }),
  z.object({ section: z.literal('questions'), category: CATEGORY }),
]);

/** One practice rating. Time is NOT accepted from the client: the server stamps it. */
export const reviewBody = z.object({
  card_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  confidence: z.number().int().min(1).max(3),
  review_id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/).optional(),
});
