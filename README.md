# U.S. + Canada Hiring Intelligence Apify Actor

This actor builds a quality-first hiring intelligence dataset for companies hiring in the United States and Canada. It uses Adzuna for broad job discovery and can also ingest no-key Greenhouse and Lever public postings, then enriches and validates company evidence with no-key public web resources before emitting final rows.

## Pipeline

```text
Adzuna job discovery + optional no-key Greenhouse/Lever public postings
  -> hard job filters
  -> no-key public web enrichment
  -> company website validation
  -> company description / size / hiring evidence extraction
  -> confidence scoring
  -> Apify dataset output
```

## API keys

Only Adzuna credentials are required:

- `adzunaAppId`
- `adzunaAppKey`

Optional Greenhouse board tokens and Lever company slugs are not API keys; they identify public no-key endpoints. Public enrichment uses unauthenticated public web pages and DuckDuckGo HTML search results. No paid enrichment API is required.

## Reliability posture

The actor is intentionally conservative:

- It excludes low-confidence rows.
- It excludes remote, global, and out-of-scope geography roles.
- It excludes stale postings outside the configured age window.
- It excludes ambiguous company names.
- It validates official company websites from source data or no-key public search; it does not guess domains.
- It extracts company descriptions from official/public company pages when available, otherwise from source job text.
- It requires explicit 11-250 employee evidence from source or public enrichment pages.
- It never fabricates company websites, company descriptions, company size, or personalization facts.

## Additional no-key job sources

In addition to Adzuna, the actor can ingest:

- Greenhouse public boards via `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`
- Lever public postings via `https://api.lever.co/v0/postings/{slug}?mode=json`

Those sources are optional and still pass through the same U.S./Canada, non-remote, mid-size, official-website, evidence, and confidence gates.


## Job-finding URL section

For industry-oriented collection, configure job discovery around explicit job-finding resources instead of relying only on broad Adzuna queries:

| Job-finding resource | URL pattern / input | Best use | API key required |
| --- | --- | --- | --- |
| Adzuna search | `https://api.adzuna.com/v1/api/jobs/{country}/search/{page}` via `searchQueries` | Broad U.S./Canada discovery by role, function, or industry keyword. | Yes |
| Greenhouse board token | `greenhouseBoardTokens: ["{token}"]` | Company-specific public Greenhouse jobs. | No |
| Lever company slug | `leverCompanySlugs: ["{slug}"]` | Company-specific public Lever jobs. | No |
| Explicit Greenhouse discovery URL | `jobDiscoveryResourceUrls: ["https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"]` | Precise endpoint-level Greenhouse ingestion for a target company/industry list. | No |
| Explicit Lever discovery URL | `jobDiscoveryResourceUrls: ["https://api.lever.co/v0/postings/{slug}?mode=json"]` | Precise endpoint-level Lever ingestion for a target company/industry list. | No |
| Industry keywords | `industryKeywords: ["healthcare", "logistics", "fintech"]` | Keeps only jobs whose title, company, location, or description matches at least one configured industry keyword. | No |

Use `industryKeywords` with either Adzuna queries or explicit Greenhouse/Lever URLs when you want industry-specific datasets.

## Public enrichment

When `enablePublicEnrichment` is true, the actor:

1. Uses any official website present in Adzuna/source fields.
2. If no acceptable website exists, searches public DuckDuckGo HTML results for the company official website.
3. Rejects aggregator/social/job-board domains as official websites.
4. Fetches a bounded set of public company pages: home, about, company, careers, and jobs.
5. Extracts meta descriptions and visible text from those pages.
6. Looks for employee-size evidence and hiring language in those public pages.
7. Adds enrichment source URLs to the final row.


## Scraped resource URL map

The actor keeps each scraped resource explicit so runs are auditable:

| Resource | URL pattern | Purpose | API key required |
| --- | --- | --- | --- |
| Adzuna search | `https://api.adzuna.com/v1/api/jobs/{country}/search/{page}` | Primary broad job discovery for U.S. and Canada roles. | Yes, Adzuna `app_id` and `app_key` |
| DuckDuckGo HTML search | `https://duckduckgo.com/html/?q={company query}` | No-key public discovery of official company websites when source data does not provide one. | No |
| Official company homepage | `{officialCompanyWebsite}` | Company description, company identity validation, and source URL evidence. | No |
| Official company about page | `{officialCompanyWebsite}/about` | Company description and employee-size evidence. | No |
| Official company company page | `{officialCompanyWebsite}/company` | Company description and employee-size evidence. | No |
| Official company careers page | `{officialCompanyWebsite}/careers` | Hiring language and public hiring evidence. | No |
| Official company jobs page | `{officialCompanyWebsite}/jobs` | Hiring language and public hiring evidence. | No |
| Greenhouse public board | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | Optional no-key job discovery for configured public Greenhouse boards. | No |
| Lever public postings | `https://api.lever.co/v0/postings/{slug}?mode=json` | Optional no-key job discovery for configured public Lever companies. | No |

Each output row includes both a flat `source_urls` field and a structured `resource_urls` object with `discovery_source_url`, `official_company_website`, and `public_enrichment_urls`.

## Output fields

Each accepted row contains:

- company name
- official company website
- factual company description
- employee range evidence
- country
- job title
- job location
- job creation date
- source and source URL
- confidence label and score
- hiring reasons
- hiring signals
- personalization-ready facts
- source URLs
- structured resource URLs by source type

## Confidence model

Rows begin with a baseline score only after passing hard gates. Additional confidence comes from hiring language, source URL quality, salary data, exact company-size evidence, and successful public enrichment. Rows below `Medium` are not emitted.

## Tradeoff

This actor optimizes reliability over volume. Public web enrichment improves coverage without new API keys, but the actor still excludes rows when evidence cannot be verified. That is intentional: unverifiable rows are excluded rather than padded with guesses.
