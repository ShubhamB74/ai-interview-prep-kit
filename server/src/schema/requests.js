import { z } from 'zod';

export const MAX_DAYS = 90;

export const registerBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72), // bcrypt limit
});

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'Must be a valid http(s) URL');

export const createKitBody = z.object({
  jd: z.string().trim().min(1, 'Job description is required').max(30_000),
  company_url: httpUrl,
  days: z.number().int().min(1).max(MAX_DAYS),
});

export const MAX_BATCH_ITEMS = 10;

/** Items are validated one by one in the route so one bad row doesn't reject the whole upload. */
export const batchKitsBody = z.object({
  days: z.number().int().min(1).max(MAX_DAYS),
  items: z.array(z.unknown()).min(1, 'Provide at least one posting').max(MAX_BATCH_ITEMS, `At most ${MAX_BATCH_ITEMS} postings per upload`),
});
