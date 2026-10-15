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
