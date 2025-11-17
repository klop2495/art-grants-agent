import * as cheerio from 'cheerio';
import type { RawOpportunity } from './types.js';

interface OpportunitySource {
  sourceName: string;
  url: string;
  notes?: string;
}

const staticSources: OpportunitySource[] = [
  {
    sourceName: 'NYFA Opportunities',
    url: 'https://www.nyfa.org/awards-grants/current-fellowships-grants/',
    notes: 'United States – grants & fellowships',
  },
  {
    sourceName: 'Creative Capital',
    url: 'https://creative-capital.org/category/opportunities/',
    notes: 'US/global open calls',
  },
  {
    sourceName: 'ResArtis',
    url: 'https://resartis.org/opportunities/',
    notes: 'Residency listings worldwide',
  },
  {
    sourceName: 'TransArtists',
    url: 'https://www.transartists.org/en/opportunities',
    notes: 'Residencies & labs',
  },
  {
    sourceName: 'On the Move',
    url: 'https://on-the-move.org/funding',
    notes: 'Mobility funding for artists',
  },
  {
    sourceName: 'ArtConnect',
    url: 'https://artconnect.com/opportunities',
    notes: 'Global calls, competitions',
  },
  {
    sourceName: 'Residency Unlimited',
    url: 'https://residencyunlimited.org/opportunities/',
    notes: 'Residencies + curatorial programs',
  },
  {
    sourceName: 'Goethe-Institut',
    url: 'https://www.goethe.de/ins/en/en/kul/ser/aue.html',
    notes: 'German cultural programmes',
  },
  {
    sourceName: 'Art Dubai',
    url: 'https://www.artdubai.ae/programme/',
    notes: 'Fair programs & residencies (MEA)',
  },
  {
    sourceName: 'Venice Biennale College',
    url: 'https://www.labiennale.org/en/biennale-college',
    notes: 'International labs & calls',
  },
];

const DOMAIN_SELECTORS: Record<string, string> = {
  'nyfa.org': 'article, main, .entry-content',
  'creative-capital.org': 'article, main, .post-content',
  'resartis.org': 'article, main, .residency-listing',
  'transartists.org': 'article, main, .node__content',
  'on-the-move.org': 'article, main, .field--name-body',
  'artconnect.com': 'article, main, .opportunity-detail',
  'residencyunlimited.org': 'article, main, .post',
  'goethe.de': 'article, main, .g-content',
  'artdubai.ae': 'article, main, .program-card',
  'labiennale.org': 'article, main, .detail-page',
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

export async function fetchRawOpportunities(): Promise<RawOpportunity[]> {
  if (staticSources.length === 0) {
    console.warn('[fetchSources] ⚠️  No opportunity sources configured');
    return [];
  }

  const maxArticles = parseInt(process.env.MAX_OPPORTUNITIES_PER_RUN ?? '20', 10);
  const results: RawOpportunity[] = [];

  for (const src of staticSources.slice(0, maxArticles)) {
    try {
      console.log(`\n[fetchSources] 📥 Fetching: ${src.sourceName}`);
      console.log(`   URL: ${src.url}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(src.url, {
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
        continue;
      }

      const html = await res.text();
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

      console.log(`   ✅ Fetched successfully (${articleHtml.length} chars)`);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.error(`   ❌ Timeout (30s) for ${src.url}`);
      } else {
        console.error(`   ❌ Error: ${err.message}`);
      }
    }
  }

  return results;
}

