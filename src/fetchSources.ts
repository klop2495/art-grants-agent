import * as cheerio from 'cheerio';
import type { RawOpportunity } from './types.js';
import { searchWeb } from './searchClient.js';

interface DirectInstitutionPage {
  sourceName: string;
  url: string;
  selector?: string;
}

interface InstitutionSearchConfig {
  institution: string;
  queries: string[];
  domains?: string[];
  maxResults?: number;
}

const DIRECT_INSTITUTION_PAGES: DirectInstitutionPage[] = [
  {
    sourceName: 'Rijksakademie Residency',
    url: 'https://www.rijksakademie.nl/en/residency/apply',
    selector: 'main article, main',
  },
  {
    sourceName: 'Delfina Foundation Programmes',
    url: 'https://www.delfinafoundation.com/programme/open-calls/',
  },
  {
    sourceName: 'ISCP Residencies',
    url: 'https://iscp-nyc.org/apply',
  },
  {
    sourceName: 'Skowhegan School of Painting & Sculpture',
    url: 'https://www.skowheganart.org/apply',
  },
  {
    sourceName: 'Banff Centre Visual Arts Residencies',
    url: 'https://www.banffcentre.ca/programs/visual-arts',
  },
  {
    sourceName: 'Sharjah Art Foundation Residencies',
    url: 'https://www.sharjahart.org/programmes/residencies',
  },
  {
    sourceName: 'Asia Cultural Council Grants',
    url: 'https://www.asiaculturalcouncil.org/fellowships/apply',
  },
  {
    sourceName: 'Fluxus Art Projects',
    url: 'https://www.fluxusartprojects.com/open-call',
  },
];

const INSTITUTION_SEARCH_CONFIGS: InstitutionSearchConfig[] = [
  {
    institution: 'Rijksakademie Residency',
    queries: [
      'Rijksakademie residency open call 2026',
      'Rijksakademie application deadline visual arts',
    ],
    domains: ['rijksakademie.nl'],
  },
  {
    institution: 'Delfina Foundation',
    queries: [
      'Delfina Foundation residency open call',
      'Delfina Foundation international programme 2026',
    ],
    domains: ['delfinafoundation.com'],
  },
  {
    institution: 'Sharjah Art Foundation',
    queries: [
      'Sharjah Art Foundation residency application',
      'Sharjah Art Foundation grants 2026',
    ],
    domains: ['sharjahart.org'],
  },
  {
    institution: 'Banff Centre',
    queries: [
      'Banff Centre visual arts residency 2026',
      'Banff Centre artist residency apply',
    ],
    domains: ['banffcentre.ca'],
  },
  {
    institution: 'Asia Cultural Council',
    queries: [
      'Asia Cultural Council fellowship 2026',
      'Asia Cultural Council grant application',
    ],
    domains: ['asiaculturalcouncil.org'],
  },
  {
    institution: 'Goethe-Institut Cultural Programmes',
    queries: [
      'Goethe-Institut residency visual arts',
      'Goethe-Institut grant open call',
    ],
    domains: ['goethe.de'],
  },
  {
    institution: 'International Studio & Curatorial Program (ISCP)',
    queries: [
      'ISCP residency open call',
      'ISCP residency funding 2026',
    ],
    domains: ['iscp-nyc.org'],
  },
  {
    institution: 'EU Creative Europe Culture',
    queries: [
      'Creative Europe Culture grant call 2026',
      'Creative Europe visual arts cooperation project',
    ],
    domains: ['culture.ec.europa.eu', 'ec.europa.eu'],
  },
  {
    institution: 'Goethe-Institut Project Space',
    queries: ['Goethe project space grant', 'Goethe Institut call for proposals arts'],
    domains: ['goethe.de'],
  },
  {
    institution: 'Sharjah Performing Arts Academy',
    queries: ['Sharjah performing arts residency', 'Sharjah residency open call'],
    domains: ['sharjah.gov.ae', 'spaa.ae'],
  },
];

const DOMAIN_SELECTORS: Record<string, string> = {
  'asiaculturalcouncil.org': 'article, main',
  'banffcentre.ca': 'article, main, .layout',
  'delfinafoundation.com': 'article, main, .content-area',
  'fluxusartprojects.com': 'article, main',
  'goethe.de': 'article, main, .text',
  'iscp-nyc.org': 'article, main, .entry-content',
  'rijksakademie.nl': 'article, main',
  'sharjahart.org': 'article, main, .section-content',
  'skowheganart.org': 'article, main, .entry-content',
};

const BLOCKED_DOMAINS = new Set([
  'artconnect.com',
  'nyfa.org',
  'creative-capital.org',
  'transartists.org',
  'residencyunlimited.org',
  'on-the-move.org',
]);

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

async function fetchDirectInstitutionPages(max: number): Promise<RawOpportunity[]> {
  const results: RawOpportunity[] = [];
  for (const src of DIRECT_INSTITUTION_PAGES) {
    if (results.length >= max) break;
    console.log(`\n[fetchSources] 🏛️ Direct: ${src.sourceName}`);
    const html = await fetchHtml(src.url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const selector = src.selector || getSelector(src.url);
    const articleHtml = $(selector).html() || html;
    results.push({
      url: src.url,
      html: articleHtml,
      sourceName: src.sourceName,
      externalId: makeExternalId(src.sourceName, src.url),
    });
    console.log(`   ✅ Captured ${articleHtml.length} chars`);
  }
  return results;
}

function isBlocked(url: string): boolean {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return BLOCKED_DOMAINS.has(domain);
  } catch {
    return false;
  }
}

async function fetchInstitutionSearchResults(max: number): Promise<RawOpportunity[]> {
  const collected: RawOpportunity[] = [];

  if (!process.env.SEARCH_API_KEY) {
    console.warn('   ⚠️  SEARCH_API_KEY missing, skipping institutional search.');
    return collected;
  }

  for (const config of INSTITUTION_SEARCH_CONFIGS) {
    for (const query of config.queries) {
      if (collected.length >= max) break;
      console.log(`\n[fetchSources] 🔎 Search: ${config.institution} — "${query}"`);
      const searchOptions: Parameters<typeof searchWeb>[1] = {
        count: config.maxResults ?? 3,
        freshness: 'Month',
      };
      if (config.domains) {
        searchOptions.domains = config.domains;
      }

      const searchResults = await searchWeb(query, searchOptions);

      for (const result of searchResults) {
        if (!result.url || isBlocked(result.url)) {
          continue;
        }
        if (collected.length >= max) break;

        const html = await fetchHtml(result.url);
        if (!html) continue;
        const selector = getSelector(result.url);
        const $ = cheerio.load(html);
        const articleHtml = $(selector).html() || html;

        collected.push({
          url: result.url,
          html: articleHtml,
          sourceName: config.institution,
          externalId: makeExternalId(config.institution, result.url),
        });
        console.log(`   ▸ Captured search result: ${result.url}`);
      }
    }
  }

  return collected;
}

export async function fetchRawOpportunities(): Promise<RawOpportunity[]> {
  const max = parseInt(process.env.MAX_OPPORTUNITIES_PER_RUN ?? '20', 10);

  const direct = await fetchDirectInstitutionPages(Math.ceil(max / 2));
  const institutionalSearch = await fetchInstitutionSearchResults(max);

  const combined = [...direct, ...institutionalSearch];
  const deduped = new Map<string, RawOpportunity>();
  for (const item of combined) {
    if (!deduped.has(item.externalId)) {
      deduped.set(item.externalId, item);
    }
  }

  return Array.from(deduped.values()).slice(0, max);
}


