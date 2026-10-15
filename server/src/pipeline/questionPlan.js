const SENIOR = /^(senior|staff|lead|principal|manager|director)$/;
const ARCH = /\b(architect\w*|distributed|scal(?:e|able|ing|ability)|microservices?|system design|infrastructure|high[- ]availability|reliab\w+|performance|cloud|databases?|data pipelines?|api design|event[- ]driven|kubernetes|aws|gcp|azure)\b/i;

/**
 * Deterministic: which question categories this kit needs and which requirements each one covers.
 * The company's published process and the role's seniority change the plan (a company that runs a system design
 * round gets system-design questions; one that says nothing, and a junior role, does not).
 * @returns {Array<{ category: string, requirements: object[], limitedCompanyInfo?: boolean }>}
 */
export function planCategories({ requirements, seniority = '', hiringProcess, hasCompanyInfo }) {
  const of = (kind) => requirements.filter((r) => r.kind === kind);
  const technical = of('technical');
  const behavioural = of('behavioural');
  const domain = of('domain');
  const plan = [];

  if (technical.length) plan.push({ category: 'technical', requirements: technical });

  const arch = technical.filter((r) => ARCH.test(r.text));
  if (technical.length && (hiringProcess?.signals?.system_design || SENIOR.test(seniority) || arch.length)) {
    const base = arch.length ? arch : technical.filter((r) => r.priority === 'must');
    plan.push({ category: 'system-design', requirements: (base.length ? base : technical).slice(0, 4) });
  }

  if (behavioural.length) plan.push({ category: 'behavioural', requirements: behavioural });

  if (hasCompanyInfo) {
    const target = domain.length ? domain : requirements.filter((r) => r.priority === 'must').slice(0, 2);
    if (target.length) plan.push({ category: 'company-fit', requirements: target });
  } else if (domain.length) {
    plan.push({ category: 'company-fit', requirements: domain, limitedCompanyInfo: true }); // domain musts still need a question
  }
  return plan;
}

/** Which category should cover a single requirement (used for gap-filling in Phase 4). */
export function categoryForRequirement(req) {
  return { technical: 'technical', behavioural: 'behavioural', domain: 'company-fit' }[req.kind] ?? 'technical';
}
