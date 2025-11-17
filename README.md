# Art Grants Agent

Node.js + TypeScript worker that collects grant / residency / open-call opportunities, converts them via GPT into structured JSON, and sends them to the Art Registry ingest API.

## Features

- Сканирует сеть за счёт комбинации целевых институций (музеи, фонды, резиденции) и веб-поиска (Bing API) с ограничением по доменам.
- GPT-промпт заточен под данные возможностей: дедлайны, финансирование, eligibility, требования.
- Фильтрует устаревшие приглашения (истёкший дедлайн или прошедшие даты программы).
- Формирует структурированный payload и отправляет его на `GRANTS_INGEST_ENDPOINT_URL`.

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
SEARCH_API_KEY=<bing-or-other-search-key>
SEARCH_API_ENDPOINT=https://api.bing.microsoft.com/v7.0/search
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

- `src/fetchSources.ts` описывает два слоя:
  - `DIRECT_INSTITUTION_PAGES` — список конкретных страниц музеев/фондов/резиденций.
  - `INSTITUTION_SEARCH_CONFIGS` — конфигурация поисковых запросов (через Bing API) по доменам институций.
- Чтобы добавить новую программу, просто расширьте один из списков и при необходимости настройте DOM‑селектор.
- Агент больше не читает агрегаторы (NYFA, ArtConnect и т.п.), чтобы избегать копирования чужих лент.

## GitHub Actions

Set repository secrets:

- `OPENAI_API_KEY`
- `GRANTS_INGEST_API_KEY`
- `GRANTS_INGEST_ENDPOINT_URL`
- `GRANDS_GITHUB_TOKEN` (for triggering workflows from the platform)

Then configure a workflow similar to the news agent (cron + manual dispatch).

