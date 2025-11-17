# Art Grants Agent

Node.js + TypeScript worker that collects grant / residency / open-call opportunities, converts them via GPT into structured JSON, and sends them to the Art Registry ingest API.

## Features

- Fetches HTML pages from trusted international sources (NYFA, Creative Capital, ResArtis, etc.)
- GPT prompt tuned for opportunity data: deadlines, funding, eligibility, requirements.
- Filters out outdated calls (deadline already passed).
- Emits structured payload and posts to `GRANTS_INGEST_ENDPOINT_URL`.

## Setup

```bash
git clone <repo>
cd art-grants-agent
npm install
```

Create `.env`:

```
OPENAI_API_KEY=sk-...
GRANTS_INGEST_API_KEY=...
GRANTS_INGEST_ENDPOINT_URL=https://artregplatform.com/api/grants/ingest
OPENAI_MODEL=gpt-4o
MAX_OPPORTUNITIES_PER_RUN=20
API_DELAY_MS=1200
DEFAULT_LANGUAGE=en
```

## Usage

```bash
npm run build
npm start
```

Development mode (`ts-node`):

```bash
npm run dev
```

## Updating Sources

`src/fetchSources.ts` contains a static list of pages. Replace with current URLs of specific grant/residency announcements for best results. For automation, extend the file with RSS parsers or web scrapers.

## GitHub Actions

Set repository secrets:

- `OPENAI_API_KEY`
- `GRANTS_INGEST_API_KEY`
- `GRANTS_INGEST_ENDPOINT_URL`
- `GRANDS_GITHUB_TOKEN` (for triggering workflows from the platform)

Then configure a workflow similar to the news agent (cron + manual dispatch).

