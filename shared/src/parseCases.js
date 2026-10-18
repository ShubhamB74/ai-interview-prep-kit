/**
 * Parses an uploaded file of description-and-company pairs into [{ jd, company_url, days? }].
 * Accepts JSON (an array, or { items | cases | postings: [...] }) or CSV with a header row.
 * Column / key names are forgiving: jd | description | job_description | posting, company_url | url | website | company.
 * Rows without both a description and a company are reported in `errors` instead of being sent.
 */
const JD_KEYS = ['jd', 'description', 'job_description', 'jobdescription', 'posting', 'job'];
const URL_KEYS = ['company_url', 'companyurl', 'url', 'website', 'company_website', 'site', 'company'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const pick = (obj, keys) => {
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.trim().toLowerCase().replace(/[\s-]+/g, '_'), v]));
  for (const k of keys) if (typeof lower[k] === 'string' && lower[k].trim()) return lower[k].trim();
  return '';
};

export function parseCasesFile(text, filename = '') {
  const errors = [];
  let rawRows;
  const trimmed = String(text).replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { items: [], errors: ['The file is empty.'] };

  if (/\.csv$/i.test(filename) || !/^[[{]/.test(trimmed)) {
    const [header, ...body] = parseCsv(trimmed);
    if (!header) return { items: [], errors: ['The file is empty.'] };
    rawRows = body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
  } else {
    let data;
    try { data = JSON.parse(trimmed); } catch { return { items: [], errors: ['The file is not valid JSON.'] }; }
    rawRows = Array.isArray(data) ? data : data?.items ?? data?.cases ?? data?.postings;
    if (!Array.isArray(rawRows)) return { items: [], errors: ['Expected a JSON array of { jd, company_url } objects.'] };
  }

  const items = [];
  rawRows.forEach((row, i) => {
    const n = i + 1;
    if (!row || typeof row !== 'object') { errors.push(`Row ${n}: not an object.`); return; }
    const jd = pick(row, JD_KEYS);
    const company_url = pick(row, URL_KEYS);
    if (!jd) { errors.push(`Row ${n}: missing a job description.`); return; }
    if (!company_url) { errors.push(`Row ${n}: missing a company website.`); return; }
    const days = Number(row.days ?? row.Days);
    items.push({ jd, company_url, ...(Number.isInteger(days) && days > 0 ? { days } : {}) });
  });
  return { items, errors };
}
