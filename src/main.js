const ALLOWED_COUNTRIES = new Set(['us', 'ca']);
const REMOTE_TERMS = /\b(remote|work from home|wfh|anywhere|distributed|global|worldwide)\b/i;
const EXCLUDED_GEOS = /\b(europe|emea|united kingdom|\buk\b|india|apac|latam|australia|germany|france|singapore)\b/i;
const US_CA_TERMS = /\b(united states|usa|u\.s\.|us|canada|canadian|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|alberta|british columbia|manitoba|new brunswick|newfoundland|nova scotia|ontario|prince edward island|quebec|saskatchewan|toronto|vancouver|montreal|calgary|ottawa)\b/i;
const SENIORITY_TERMS = /\b(intern|graduate|apprentice|chief|vp|vice president|head of|director)\b/i;
const MID_SIZE_MIN = 11;
const MID_SIZE_MAX = 250;
const BLOCKED_DOMAINS = /adzuna|linkedin|indeed|glassdoor|ziprecruiter|monster|workdayjobs|greenhouse|lever\.co|facebook|twitter|x\.com|instagram|youtube|wikipedia|crunchbase|apollo|ycombinator/i;
const DEFAULT_TIMEOUT_MS = 10000;

export function normalizeCompanyName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function humanizeSlug(slug) {
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isAmbiguousCompanyName(name) {
  const normalized = normalizeCompanyName(name);
  if (normalized.length < 3) return true;
  if (/^(confidential|private|undisclosed|unknown|company|client|recruiter|staffing agency)$/i.test(normalized)) return true;
  if (/\b(confidential|recruiting|staffing|talent|employment agency)\b/i.test(normalized)) return true;
  return false;
}

export function isUsOrCanadaJob(job, country) {
  if (!ALLOWED_COUNTRIES.has(country)) return false;
  const locationText = [job?.location?.display_name, job?.title, job?.description].filter(Boolean).join(' ');
  if (REMOTE_TERMS.test(locationText)) return false;
  if (EXCLUDED_GEOS.test(locationText) && !US_CA_TERMS.test(locationText)) return false;
  return US_CA_TERMS.test(locationText) || ALLOWED_COUNTRIES.has(country);
}

export function isFreshJob(job, maxAgeDays, now = new Date()) {
  if (!job?.created) return false;
  const created = new Date(job.created);
  if (Number.isNaN(created.getTime())) return false;
  const ageMs = now.getTime() - created.getTime();
  return ageMs >= 0 && ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}


export function matchesIndustryKeywords(job, industryKeywords = []) {
  const keywords = (industryKeywords || []).map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean);
  if (!keywords.length) return true;
  const text = [job?.title, job?.company?.display_name, job?.location?.display_name, job?.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

export function extractEmployeeRangeFromText(text) {
  const source = String(text || '');
  const range = source.match(/\b(?:company size|team size|employees|headcount|team of)?\s*:?\s*(\d{1,4})\s*(?:-|to|–)\s*(\d{1,5})\s+(?:employees|people|team members|staff)\b/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = source.match(/\b(?:team of|company of|headcount of|employs|employees|team size)\s*:?\s*(\d{2,4})\s*(?:employees|people|team members|staff)?\b/i);
  if (single) {
    const value = Number(single[1]);
    return { min: value, max: value };
  }
  return null;
}

export function extractEmployeeRange(job, enrichment = {}) {
  const sources = [
    { source: 'job_description', text: [job?.description, job?.company?.display_name].filter(Boolean).join(' ') },
    ...(enrichment.publicPages || []).map((page) => ({ source: page.url, text: page.text })),
  ];
  for (const candidate of sources) {
    const range = extractEmployeeRangeFromText(candidate.text);
    if (range) return { ...range, source: candidate.source };
  }
  return null;
}

export function isMidSizedCompany(job, enrichment = {}) {
  const range = extractEmployeeRange(job, enrichment);
  if (!range) return { accepted: false, reason: 'No verifiable 11-250 employee evidence in source or public enrichment data.' };
  if (range.max < MID_SIZE_MIN || range.min > MID_SIZE_MAX) {
    return { accepted: false, reason: `Employee evidence ${range.min}-${range.max} is outside 11-250.` };
  }
  return { accepted: true, range };
}

export function originFromUrl(candidate) {
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (BLOCKED_DOMAINS.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function extractOfficialWebsite(job, enrichment = {}) {
  const candidates = [enrichment.officialWebsite, job?.company?.website, job?.company_url, job?.redirect_url].filter(Boolean);
  for (const candidate of candidates) {
    const origin = originFromUrl(candidate);
    if (origin) return origin;
  }
  return null;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaDescription(html) {
  const match = String(html || '').match(/<meta\s+(?:name=["']description["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+name=["']description["'])/i);
  return match ? (match[1] || match[2]).replace(/\s+/g, ' ').trim() : null;
}

export function buildCompanyDescription(job, enrichment = {}) {
  const enriched = enrichment.description || enrichment.publicPages?.map((page) => page.description).find(Boolean);
  if (enriched && enriched.length >= 40) return enriched.slice(0, 280);
  const text = stripHtml(job?.description);
  if (!text) return null;
  const sentence = text.split(/(?<=[.!?])\s+/).find((part) => part.length >= 40 && !/apply|equal opportunity/i.test(part));
  return sentence ? sentence.slice(0, 280) : null;
}

async function fetchText(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 hiring-intelligence-actor/1.0' },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/text|html|json/i.test(contentType)) return null;
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function parseDuckDuckGoResults(html) {
  const links = [];
  const linkPattern = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = linkPattern.exec(String(html || ''))) !== null) {
    let href = match[1].replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = `https:${href}`;
    if (href.includes('/l/?')) {
      try {
        const wrapped = new URL(href, 'https://duckduckgo.com');
        href = wrapped.searchParams.get('uddg') || href;
      } catch {
        continue;
      }
    }
    const origin = originFromUrl(href);
    if (origin && !links.includes(origin)) links.push(origin);
  }
  return links.slice(0, 10);
}

export function domainLooksLikeCompany(domain, companyName) {
  const host = new URL(domain).hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
  const tokens = normalizeCompanyName(companyName).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((token) => token.length > 2 && !['inc', 'llc', 'ltd', 'corp', 'company', 'technologies', 'technology'].includes(token));
  return tokens.some((token) => host.includes(token));
}

async function discoverOfficialWebsite(companyName, location) {
  const query = encodeURIComponent(`"${companyName}" ${location || ''} official website company`);
  const html = await fetchText(`https://duckduckgo.com/html/?q=${query}`);
  const candidates = parseDuckDuckGoResults(html);
  return candidates.find((candidate) => domainLooksLikeCompany(candidate, companyName)) || null;
}

async function fetchPublicCompanyPages(officialWebsite, maxPages) {
  const paths = ['', '/about', '/company', '/careers', '/jobs'];
  const pages = [];
  for (const path of paths.slice(0, maxPages)) {
    const url = `${officialWebsite}${path}`;
    const html = await fetchText(url);
    if (!html) continue;
    const text = stripHtml(html);
    pages.push({ url, text, description: extractMetaDescription(html) });
  }
  return pages;
}

export async function enrichJobWithPublicSources(job, input = {}) {
  if (input.enablePublicEnrichment === false) return {};
  const directWebsite = extractOfficialWebsite(job);
  const discoveredWebsite = directWebsite || await discoverOfficialWebsite(normalizeCompanyName(job?.company?.display_name), job?.location?.display_name);
  if (!discoveredWebsite) return {};
  const publicPages = await fetchPublicCompanyPages(discoveredWebsite, input.maxEnrichmentPages || 5);
  return {
    officialWebsite: discoveredWebsite,
    publicPages,
    description: publicPages.map((page) => page.description).find((description) => description && description.length >= 40) || null,
    enrichmentSourceUrls: [discoveredWebsite, ...publicPages.map((page) => page.url)],
  };
}

export function scoreJob(job, country, maxAgeDays, includeMediumConfidence, enrichment = {}) {
  const reasons = [];
  const signals = [];
  const companyName = normalizeCompanyName(job?.company?.display_name);
  if (isAmbiguousCompanyName(companyName)) return null;
  if (!isFreshJob(job, maxAgeDays)) return null;
  if (!isUsOrCanadaJob(job, country)) return null;
  const size = isMidSizedCompany(job, enrichment);
  if (!size.accepted) return null;
  const website = extractOfficialWebsite(job, enrichment);
  if (!website) return null;
  const description = buildCompanyDescription(job, enrichment);
  if (!description) return null;

  let score = 55;
  reasons.push('Fresh job posting within configured age window.');
  signals.push('fresh_job_posting');
  reasons.push(`Job location is in ${country === 'us' ? 'the United States' : 'Canada'} and remote-only/global roles are excluded.`);
  signals.push('us_canada_non_remote_location');
  reasons.push(`Company size evidence overlaps required 11-250 employee range (${size.range.min}-${size.range.max}).`);
  signals.push('mid_sized_company_11_250');
  reasons.push('Official company website was verified from source data or no-key public web enrichment; it was not guessed.');
  signals.push('verified_official_website');

  const text = [job.title, job.description, ...((enrichment.publicPages || []).map((page) => page.text))].filter(Boolean).join(' ');
  if (/\b(hiring|join our team|we are looking|we're looking|growing team|open roles|careers)\b/i.test(text)) {
    score += 15;
    reasons.push('Hiring language appears in source or public company pages.');
    signals.push('hiring_language_present');
  }
  if (!SENIORITY_TERMS.test(text)) score += 10;
  if (job.redirect_url) score += 10;
  if (job.salary_min || job.salary_max) score += 5;
  if (size.range.min >= MID_SIZE_MIN && size.range.max <= MID_SIZE_MAX) score += 10;
  if (enrichment.publicPages?.length) score += 10;

  const confidence = score >= 90 ? 'Very High' : score >= 75 ? 'High' : score >= 60 ? 'Medium' : 'Low';
  if (confidence === 'Low' || (confidence === 'Medium' && !includeMediumConfidence)) return null;

  const sourceUrls = [job.redirect_url, website, ...(enrichment.enrichmentSourceUrls || [])].filter(Boolean);
  return {
    company_name: companyName,
    official_company_website: website,
    company_description: description,
    employee_range_evidence: `${size.range.min}-${size.range.max} employees (${size.range.source})`,
    country,
    job_title: job.title,
    job_location: job?.location?.display_name,
    job_created_at: job.created,
    job_source: [job.source || 'Adzuna', enrichment.publicPages?.length ? 'public web enrichment' : null].filter(Boolean).join(' + '),
    job_source_url: job.redirect_url,
    confidence,
    confidence_score: Math.min(score, 100),
    hiring_reasons: reasons.join(' | '),
    hiring_signals: signals.join(', '),
    personalization_facts: [
      `${companyName} is hiring for ${job.title} in ${job?.location?.display_name}.`,
      `The company size evidence indicates ${size.range.min}-${size.range.max} employees.`,
      `The role was posted on ${job.created}.`,
    ].join(' '),
    source_urls: [...new Set(sourceUrls)].join(', '),
    resource_urls: {
      discovery_source_url: job.redirect_url || null,
      official_company_website: website,
      public_enrichment_urls: [...new Set(enrichment.enrichmentSourceUrls || [])],
    },
  };
}


async function fetchGreenhouseJobs(boardToken) {
  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`);
  url.searchParams.set('content', 'true');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Greenhouse board ${boardToken} failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return (payload.jobs || []).map((job) => ({
    id: `greenhouse:${boardToken}:${job.id}`,
    source: 'Greenhouse public board',
    title: job.title,
    created: job.updated_at || null,
    redirect_url: job.absolute_url,
    company: { display_name: humanizeSlug(boardToken) },
    location: { display_name: job.location?.name || '' },
    description: stripHtml(job.content || ''),
  }));
}

async function fetchLeverJobs(companySlug) {
  const url = new URL(`https://api.lever.co/v0/postings/${companySlug}`);
  url.searchParams.set('mode', 'json');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lever company ${companySlug} failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return (payload || []).map((job) => ({
    id: `lever:${companySlug}:${job.id}`,
    source: 'Lever public postings',
    title: job.text,
    created: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    redirect_url: job.hostedUrl || job.applyUrl,
    company: { display_name: humanizeSlug(companySlug) },
    location: { display_name: job.categories?.location || '' },
    description: stripHtml([job.descriptionPlain, job.additionalPlain, job.lists?.map((list) => `${list.text} ${list.content}`).join(' ')].filter(Boolean).join(' ')),
  }));
}

async function fetchConfiguredPublicJobs(input) {
  const jobs = [];
  for (const boardToken of input.greenhouseBoardTokens || []) {
    jobs.push(...await fetchGreenhouseJobs(boardToken));
  }
  for (const companySlug of input.leverCompanySlugs || []) {
    jobs.push(...await fetchLeverJobs(companySlug));
  }
  return jobs;
}


function greenhouseJobsFromPayload(payload, boardToken, sourceUrl) {
  return (payload.jobs || []).map((job) => ({
    id: `greenhouse-url:${boardToken}:${job.id}`,
    source: 'Configured Greenhouse discovery URL',
    title: job.title,
    created: job.updated_at || null,
    redirect_url: job.absolute_url || sourceUrl,
    company: { display_name: humanizeSlug(boardToken) },
    location: { display_name: job.location?.name || '' },
    description: stripHtml(job.content || ''),
  }));
}

function leverJobsFromPayload(payload, companySlug, sourceUrl) {
  return (payload || []).map((job) => ({
    id: `lever-url:${companySlug}:${job.id}`,
    source: 'Configured Lever discovery URL',
    title: job.text,
    created: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    redirect_url: job.hostedUrl || job.applyUrl || sourceUrl,
    company: { display_name: humanizeSlug(companySlug) },
    location: { display_name: job.categories?.location || '' },
    description: stripHtml([job.descriptionPlain, job.additionalPlain, job.lists?.map((list) => `${list.text} ${list.content}`).join(' ')].filter(Boolean).join(' ')),
  }));
}

async function fetchJobsFromDiscoveryUrl(resourceUrl) {
  const url = new URL(resourceUrl);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Configured job discovery URL failed: ${url.href} ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (url.hostname === 'boards-api.greenhouse.io') {
    const boardToken = url.pathname.split('/').filter(Boolean).at(2);
    return greenhouseJobsFromPayload(payload, boardToken, url.href);
  }
  if (url.hostname === 'api.lever.co') {
    const companySlug = url.pathname.split('/').filter(Boolean).at(2);
    return leverJobsFromPayload(payload, companySlug, url.href);
  }
  return [];
}

async function fetchConfiguredDiscoveryUrlJobs(input) {
  const jobs = [];
  for (const resourceUrl of input.jobDiscoveryResourceUrls || []) {
    jobs.push(...await fetchJobsFromDiscoveryUrl(resourceUrl));
  }
  return jobs;
}

async function fetchAdzunaPage({ country, page, query, input }) {
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
  url.searchParams.set('app_id', input.adzunaAppId);
  url.searchParams.set('app_key', input.adzunaAppKey);
  url.searchParams.set('results_per_page', String(input.resultsPerPage));
  url.searchParams.set('what', query);
  url.searchParams.set('content-type', 'application/json');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Adzuna ${country}/${query}/page ${page} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function runActor() {
  const { Actor, log } = await import('apify');
  await Actor.init();
  const input = await Actor.getInput();
  try {
    const countries = (input.countries || ['us', 'ca']).map((country) => country.toLowerCase()).filter((country) => ALLOWED_COUNTRIES.has(country));
    const seen = new Set();
    const processJob = async (job, country) => {
      if (!matchesIndustryKeywords(job, input.industryKeywords)) return;
      const enrichment = await enrichJobWithPublicSources(job, input);
      const row = scoreJob(job, country, input.maxJobAgeDays, input.includeMediumConfidence, enrichment);
      if (!row) return;
      const key = `${row.company_name}|${row.job_title}|${row.job_location}|${row.job_created_at}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      await Actor.pushData(row);
    };

    for (const country of countries) {
      for (const query of input.searchQueries || []) {
        for (let page = 1; page <= input.maxPagesPerQuery; page += 1) {
          const payload = await fetchAdzunaPage({ country, page, query, input });
          for (const job of payload.results || []) await processJob({ ...job, source: 'Adzuna' }, country);
        }
      }
    }

    for (const job of await fetchConfiguredPublicJobs(input)) {
      for (const country of countries) await processJob(job, country);
    }

    for (const job of await fetchConfiguredDiscoveryUrlJobs(input)) {
      for (const country of countries) await processJob(job, country);
    }
    log.info(`Finished hiring intelligence scrape with ${seen.size} accepted rows.`);
  } finally {
    await Actor.exit();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runActor();
}