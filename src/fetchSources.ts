import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import type { RawOpportunity } from './types.js';

interface InstitutionalSource {
  sourceName: string;
  url: string;
  notes?: string;
}

interface RssSource {
  sourceName: string;
  feedUrl: string;
  keywordFilters?: string[];
  limit?: number;
}

interface ListingSource {
  sourceName: string;
  url: string;
  linkSelector: string;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  absoluteBase?: string;
  limit?: number;
}

const KEYWORDS = ['grant', 'residency', 'open call', 'artists', 'fellowship', 'competition'];

const institutionalSources: InstitutionalSource[] = [
  {
    sourceName: 'Residency Unlimited',
    url: 'https://residencyunlimited.org/opportunities/',
  },
  {
    sourceName: 'On the Move',
    url: 'https://on-the-move.org/funding',
  },
  {
    sourceName: 'ArtConnect',
    url: 'https://artconnect.com/opportunities',
  },
  {
    sourceName: 'Venice Biennale College',
    url: 'https://www.labiennale.org/en/biennale-college',
  },
];

const rssSources: RssSource[] = [
  {
    sourceName: 'ArtConnect RSS',
    feedUrl: 'https://artconnect.com/feed',
    keywordFilters: KEYWORDS,
    limit: 10,
  },
  {
    sourceName: 'TransArtists RSS',
    feedUrl: 'https://www.transartists.org/feeds/opportunities',
    keywordFilters: KEYWORDS,
    limit: 10,
  },
];

const listingSources: ListingSource[] = [
  {
    sourceName: 'NYFA Listings',
    url: 'https://www.nyfa.org/opportunities',
    linkSelector: 'article a',
    includeKeywords: KEYWORDS,
    absoluteBase: 'https://www.nyfa.org',
    limit: 8,
  },
  {
    sourceName: 'Creative Capital Listings',
    url: 'https://creative-capital.org/category/opportunities/',
    linkSelector: 'article a',
    includeKeywords: KEYWORDS,
    limit: 8,
  },
];

const DOMAIN_SELECTORS: Record<string, string> = {
  'residencyunlimited.org': 'article, main, .post',
  'on-the-move.org': 'article, main, .field--name-body',
  'artconnect.com': 'article, main, .opportunity-detail',
  'labiennale.org': 'article, main, .detail-page',
  'nyfa.org': 'article, main, .entry-content',
  'creative-capital.org': 'article, main, .post-content',
};

function makeExternalId(sourceName: string, url: string): string {
  const base = `${sourceName}-${url}`;
  return Buffer.from(base).toString('base64').replace(/=+$/g, '');
}

function getSelector(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return DOMAIN_SELECTORS[domain] || 'article, main';
  } catch {
    return 'article, main';
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ArtGrantsAgent/1.0; +https://artregplatform.com)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`   ❌ HTTP ${res.status} ${res.statusText}`);
      return null;
    }

    return await res.text();
  } catch (err: any) {
    console.error(`   ❌ Error fetching ${url}: ${err.message}`);
    return null;
  }
}

async function fetchInstitutionalSources(max: number): Promise<RawOpportunity[]> {
  const results: RawOpportunity[] = [];
  for (const src of institutionalSources.slice(0, max)) {
    console.log(`\n[fetchSources] 📥 Fetching: ${src.sourceName}`);
    const html = await fetchHtml(src.url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const selector = getSelector(src.url);
    const articleHtml = $(selector).html() || html;
    const externalId = makeExternalId(src.sourceName, src.url);

    results.push({
      url: src.url,
      html: articleHtml,
      sourceName: src.sourceName,
      externalId,
    });
    console.log(`   ✅ Fetched ${articleHtml.length} chars`);
  }
  return results;
}

async function fetchRssSources(max: number): Promise<RawOpportunity[]> {
  const parser = new Parser();
  const rows: RawOpportunity[] = [];

  for (const feed of rssSources) {
    console.log(`\n[fetchSources] 📡 RSS: ${feed.sourceName}`);
    try {
      const data = await parser.parseURL(feed.feedUrl);
      const items = (data.items ?? []).slice(0, feed.limit ?? max);

      for (const item of items) {
        const link = item.link;
        if (!link) continue;
        const title = item.title?.toLowerCase() ?? '';
        if (
          feed.keywordFilters &&
          !feed.keywordFilters.some((keyword) => title.includes(keyword.toLowerCase()))
        ) {
          continue;
        }

        const html = await fetchHtml(link);
        if (!html) continue;
        const selector = getSelector(link);
        const $ = cheerio.load(html);
        const articleHtml = $(selector).html() || html;

        rows.push({
          url: link,
          html: articleHtml,
          sourceName: feed.sourceName,
          externalId: makeExternalId(feed.sourceName, link),
        });
        console.log(`   ▸ RSS entry added: ${item.title}`);
      }
    } catch (err: any) {
      console.error(`   ❌ RSS error: ${err.message}`);
    }
  }

  return rows.slice(0, max);
}

async function fetchListingSources(max: number): Promise<RawOpportunity[]> {
  const results: RawOpportunity[] = [];

  for (const listing of listingSources) {
    console.log(`\n[fetchSources] 📄 Listing: ${listing.sourceName}`);
    const html = await fetchHtml(listing.url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const links = new Set<string>();

    $(listing.linkSelector)
      .slice(0, listing.limit ?? max)
      .each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        let absolute = href;
        if (listing.absoluteBase && href.startsWith('/')) {
          absolute = listing.absoluteBase + href;
        }
        links.add(absolute);
      });

    for (const link of links) {
      const lower = link.toLowerCase();
      if (
        listing.includeKeywords &&
        !listing.includeKeywords.some((keyword) => lower.includes(keyword.replace(/\s+/g, '-')))
      ) {
        continue;
      }
      if (
        listing.excludeKeywords &&
        listing.excludeKeywords.some((keyword) => lower.includes(keyword))
      ) {
        continue;
      }

      const detailHtml = await fetchHtml(link);
      if (!detailHtml) continue;

      const selector = getSelector(link);
      const $detail = cheerio.load(detailHtml);
      const articleHtml = $detail(selector).html() || detailHtml;

      results.push({
        url: link,
        html: articleHtml,
        sourceName: listing.sourceName,
        externalId: makeExternalId(listing.sourceName, link),
      });
      console.log(`   ▸ Listing entry added: ${link}`);
    }
  }

  return results.slice(0, max);
}

export async function fetchRawOpportunities(): Promise<RawOpportunity[]> {
  const max = parseInt(process.env.MAX_OPPORTUNITIES_PER_RUN ?? '20', 10);

  const institutional = await fetchInstitutionalSources(max);
  const rss = await fetchRssSources(max);
  const listings = await fetchListingSources(max);

  const combined = [...institutional, ...rss, ...listings];
  // Deduplicate by externalId
  const deduped = new Map<string, RawOpportunity>();
  for (const item of combined) {
    if (!deduped.has(item.externalId)) {
      deduped.set(item.externalId, item);
    }
  }

  return Array.from(deduped.values()).slice(0, max);
}


