/**
 * DETERMINISTIC (no model): spreads the question bank over exactly `daysAvailable` days.
 *
 * 1. Order questions by priority: those covering a must-have first, then harder first, then original order.
 * 2. If there are at least as many questions as days, cut that order into `daysAvailable` consecutive blocks of
 *    roughly equal study time. Because the order is priority-first, harder and must-have material lands on the
 *    earliest days and the lightest, nice-to-have material on the last day (never a heavy "night before").
 * 3. If there are fewer questions than days (a 60-day plan for 12 questions), every question gets its own study
 *    day first, then the remaining days are REVIEW days that cycle back through the same priority order.
 * Every question appears at least once, so every requirement that has a question is scheduled.
 * Minutes are integers: 10/15/25 per question by difficulty (review days: half, rounded up).
 */
const STUDY_MINUTES = { 1: 10, 2: 15, 3: 25 };
const CATEGORY_LABEL = { technical: 'Technical', behavioural: 'Behavioural', 'system-design': 'System design', 'company-fit': 'Company fit' };

export const questionMinutes = (q) => STUDY_MINUTES[q.difficulty] ?? 15;
const reviewMinutes = (q) => Math.max(5, Math.ceil(questionMinutes(q) / 2));

function priorityOrder(questions, requirements) {
  const mustIds = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  return questions
    .map((q, i) => ({ q, i, must: q.requirement_ids.some((id) => mustIds.has(id)) ? 1 : 0 }))
    .sort((a, b) => b.must - a.must || b.q.difficulty - a.q.difficulty || a.i - b.i)
    .map((x) => x.q);
}

function partition(ordered, days) {
  const target = ordered.reduce((n, q) => n + questionMinutes(q), 0) / days;
  const out = Array.from({ length: days }, () => []);
  let d = 0;
  let acc = 0;
  ordered.forEach((q, idx) => {
    out[d].push(q);
    acc += questionMinutes(q);
    const leftQs = ordered.length - idx - 1;
    const leftDays = days - d - 1;
    // advance when this day is full, or when every remaining day needs exactly one of the remaining questions
    if (leftDays > 0 && leftQs >= leftDays && (acc >= target || leftQs === leftDays)) { d++; acc = 0; }
  });
  return out;
}

function focusFor(qs, reqById, prefix = '') {
  const seen = new Set();
  const reqs = [];
  for (const q of qs) for (const id of q.requirement_ids) {
    const r = reqById.get(id);
    if (r && !seen.has(id)) { seen.add(id); reqs.push(r); }
  }
  reqs.sort((a, b) => Number(b.priority === 'must') - Number(a.priority === 'must'));
  const cats = [...new Set(qs.map((q) => CATEGORY_LABEL[q.category] ?? q.category))].join(' & ');
  const shown = reqs.slice(0, 2).map((r) => (r.text.length > 60 ? `${r.text.slice(0, 57)}...` : r.text)).join('; ');
  const more = reqs.length > 2 ? ` (+${reqs.length - 2} more)` : '';
  return `${prefix}${cats}${shown ? `: ${shown}${more}` : ''}`;
}

/** @returns {{ days_available: number, days: Array<{day, focus, question_ids, minutes, type}> }} */
export function allocateSchedule({ questions, requirements, daysAvailable }) {
  if (!Number.isInteger(daysAvailable) || daysAvailable < 1) throw new RangeError('daysAvailable must be a positive integer');
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const ordered = priorityOrder(questions, requirements);
  const N = ordered.length;
  const days = [];

  if (N === 0) {
    for (let day = 1; day <= daysAvailable; day++) {
      days.push({ day, focus: 'No practice questions: the job description gave too little to build a plan', question_ids: [], minutes: 0, type: 'study' });
    }
    return { days_available: daysAvailable, days };
  }

  const study = N >= daysAvailable ? partition(ordered, daysAvailable) : ordered.map((q) => [q]);
  study.forEach((qs, i) => days.push({
    day: i + 1, focus: focusFor(qs, reqById), question_ids: qs.map((q) => q.id), minutes: qs.reduce((n, q) => n + questionMinutes(q), 0), type: 'study',
  }));

  const reviewDays = daysAvailable - study.length; // 0 whenever N >= daysAvailable
  if (reviewDays > 0) {
    const batch = Math.min(N, Math.ceil(N / reviewDays));
    for (let j = 0; j < reviewDays; j++) {
      const qs = Array.from({ length: batch }, (_, k) => ordered[(j * batch + k) % N]);
      days.push({
        day: study.length + j + 1, focus: focusFor(qs, reqById, 'Review: '), question_ids: qs.map((q) => q.id), minutes: qs.reduce((n, q) => n + reviewMinutes(q), 0), type: 'review',
      });
    }
  }
  return { days_available: daysAvailable, days };
}
