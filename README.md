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

## Public enrichment

When `enablePublicEnrichment` is true, the actor:

1. Uses any official website present in Adzuna/source fields.
2. If no acceptable website exists, searches public DuckDuckGo HTML results for the company official website.
3. Rejects aggregator/social/job-board domains as official websites.
4. Fetches a bounded set of public company pages: home, about, company, careers, and jobs.
5. Extracts meta descriptions and visible text from those pages.
6. Looks for employee-size evidence and hiring language in those public pages.
7. Adds enrichment source URLs to the final row.

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

## Confidence model

Rows begin with a baseline score only after passing hard gates. Additional confidence comes from hiring language, source URL quality, salary data, exact company-size evidence, and successful public enrichment. Rows below `Medium` are not emitted.

## Tradeoff

This actor optimizes reliability over volume. Public web enrichment improves coverage without new API keys, but the actor still excludes rows when evidence cannot be verified. That is intentional: unverifiable rows are excluded rather than padded with guesses.
