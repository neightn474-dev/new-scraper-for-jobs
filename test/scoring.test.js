import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichJobWithPublicSources,
  extractOfficialWebsite,
  isAmbiguousCompanyName,
  isFreshJob,
  isUsOrCanadaJob,
  matchesIndustryKeywords,
  parseDuckDuckGoResults,
  scoreJob,
} from '../src/main.js';

const freshDate = '2026-06-10T12:00:00Z';
const now = new Date('2026-06-17T00:00:00Z');

function job(overrides = {}) {
  return {
    title: 'Software Engineer',
    created: freshDate,
    redirect_url: 'https://example-company.com/careers/software-engineer',
    company: {
      display_name: 'Example Robotics',
    },
    location: {
      display_name: 'Austin, Texas, United States',
    },
    description: 'Example Robotics builds warehouse automation products for mid-market logistics teams. We are looking for a Software Engineer to join our growing team. Company size: 75-120 employees.',
    salary_min: 120000,
    ...overrides,
  };
}

test('rejects ambiguous company names', () => {
  assert.equal(isAmbiguousCompanyName('Confidential'), true);
  assert.equal(isAmbiguousCompanyName('Acme Manufacturing'), false);
});

test('freshness check rejects stale and future jobs', () => {
  assert.equal(isFreshJob(job(), 30, now), true);
  assert.equal(isFreshJob(job({ created: '2026-01-01T00:00:00Z' }), 30, now), false);
  assert.equal(isFreshJob(job({ created: '2026-07-01T00:00:00Z' }), 30, now), false);
});

test('geographic filter rejects remote and out-of-scope roles', () => {
  assert.equal(isUsOrCanadaJob(job(), 'us'), true);
  assert.equal(isUsOrCanadaJob(job({ location: { display_name: 'Remote' } }), 'us'), false);
  assert.equal(isUsOrCanadaJob(job({ location: { display_name: 'Berlin, Germany' } }), 'de'), false);
});



test('industry keyword filter keeps matching industry jobs only', () => {
  assert.equal(matchesIndustryKeywords(job({ description: 'Healthcare operations software for clinics.' }), ['healthcare']), true);
  assert.equal(matchesIndustryKeywords(job({ description: 'Logistics operations platform.' }), ['healthcare']), false);
  assert.equal(matchesIndustryKeywords(job(), []), true);
});

test('official website is never guessed from aggregators', () => {
  assert.equal(extractOfficialWebsite(job()), 'https://example-company.com');
  assert.equal(extractOfficialWebsite(job({ redirect_url: 'https://www.adzuna.com/details/123' })), null);
});

test('scoreJob emits only evidence-backed medium-or-better rows', () => {
  const row = scoreJob(job(), 'us', 30, true);
  assert.equal(row.company_name, 'Example Robotics');
  assert.equal(row.official_company_website, 'https://example-company.com');
  assert.match(row.employee_range_evidence, /75-120 employees/);
  assert.ok(['Very High', 'High', 'Medium'].includes(row.confidence));
  assert.match(row.hiring_signals, /fresh_job_posting/);
});

test('scoreJob can use public enrichment for website, description, and size evidence', () => {
  const row = scoreJob(
    job({
      redirect_url: 'https://www.adzuna.com/details/123',
      description: 'We are looking for a Software Engineer to join our growing team.',
    }),
    'us',
    30,
    true,
    {
      officialWebsite: 'https://example-robotics.com',
      description: 'Example Robotics builds warehouse automation systems for regional logistics operators.',
      publicPages: [{ url: 'https://example-robotics.com/about', text: 'Example Robotics has 75-120 employees and is hiring for open roles.' }],
      enrichmentSourceUrls: ['https://example-robotics.com/about'],
    },
  );

  assert.equal(row.official_company_website, 'https://example-robotics.com');
  assert.match(row.employee_range_evidence, /75-120 employees/);
  assert.match(row.source_urls, /example-robotics.com\/about/);
  assert.equal(row.resource_urls.official_company_website, 'https://example-robotics.com');
  assert.deepEqual(row.resource_urls.public_enrichment_urls, ['https://example-robotics.com/about']);
});

test('scoreJob excludes rows without company size evidence', () => {
  const row = scoreJob(job({ description: 'Example Robotics builds warehouse automation products for logistics teams.' }), 'us', 30, true);
  assert.equal(row, null);
});

test('parses public search result links and rejects blocked domains', () => {
  const html = '<a href="/l/?uddg=https%3A%2F%2Fexample-robotics.com%2Fabout">Official</a><a href="https://linkedin.com/company/example">LinkedIn</a>';
  assert.deepEqual(parseDuckDuckGoResults(html), ['https://example-robotics.com']);
});

test('public enrichment discovers site and fetches public pages without API keys', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('duckduckgo.com')) {
      return new Response('<a href="/l/?uddg=https%3A%2F%2Fexample-robotics.com%2F">Official</a>', { headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><head><meta name="description" content="Example Robotics builds warehouse automation products for logistics teams."></head><body>Team size: 75-120 employees. Careers and open roles.</body></html>', { headers: { 'content-type': 'text/html' } });
  };

  try {
    const enrichment = await enrichJobWithPublicSources(job({ redirect_url: 'https://www.adzuna.com/details/123' }), { maxEnrichmentPages: 1 });
    assert.equal(enrichment.officialWebsite, 'https://example-robotics.com');
    assert.equal(enrichment.publicPages.length, 1);
    assert.match(enrichment.description, /warehouse automation/);
  } finally {
    global.fetch = originalFetch;
  }
});