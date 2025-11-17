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
  // Ireland
  { sourceName: 'Arts Council Ireland', url: 'https://www.artscouncil.ie/Funds/' },
  { sourceName: 'Fire Station Artists’ Studios', url: 'https://www.firestation.ie/opportunities/' },
  { sourceName: 'Create Ireland', url: 'https://www.create-ireland.ie/category/opportunities/' },
  { sourceName: 'Temple Bar Gallery + Studios', url: 'https://www.templebargallery.com/opportunities' },
  // UK & Europe
  { sourceName: 'Arts Council England - Project Grants', url: 'https://www.artscouncil.org.uk/our-open-funds/national-lottery-project-grants' },
  { sourceName: 'Arts Council England - DYCP', url: 'https://www.artscouncil.org.uk/dycp' },
  { sourceName: 'Creative Scotland - Open Fund', url: 'https://www.creativescotland.com/funding/funding-programmes/open-fund' },
  { sourceName: 'Arts Council Wales', url: 'https://arts.wales/funding/get-started' },
  { sourceName: 'Arts Council Northern Ireland', url: 'https://artscouncil-ni.org/funding-opportunities' },
  { sourceName: 'British Council Arts', url: 'https://www.britishcouncil.org/arts/our-programmes' },
  { sourceName: 'Goethe-Institut Residencies', url: 'https://www.goethe.de/en/kul/foe/res.html' },
  { sourceName: 'Paul Hamlyn Foundation Awards', url: 'https://www.phf.org.uk/funds/awards-for-artists/' },
  { sourceName: 'Jerwood Arts', url: 'https://jerwoodarts.org/projects/' },
  { sourceName: 'Henry Moore Foundation Grants', url: 'https://www.henry-moore.org/grants' },
  { sourceName: 'Esmée Fairbairn Foundation Arts', url: 'https://esmeefairbairn.org.uk/our-support/arts/' },
  { sourceName: 'Wellcome Trust Arts', url: 'https://wellcome.org/what-we-do/our-work/arts-and-health' },
  { sourceName: 'Delfina Foundation Programmes', url: 'https://www.delfinafoundation.com/programmes/' },
  { sourceName: 'Gasworks International Residencies', url: 'https://www.gasworks.org.uk/residencies/' },
  { sourceName: 'Camden Arts Centre Residencies', url: 'https://www.camdenartscentre.org/whats-on/artists-residency' },
  { sourceName: 'Wysing Arts Centre', url: 'https://www.wysingartscentre.org/residencies' },
  { sourceName: 'Hospitalfield Programmes', url: 'https://hospitalfield.org.uk/programme/residencies/' },
  { sourceName: 'Cove Park Residencies', url: 'https://www.covepark.org/residencies/' },
  { sourceName: 'Rijksakademie Residency', url: 'https://www.rijksakademie.nl/en/residency/apply', selector: 'main article, main' },
  { sourceName: 'Jan van Eyck Academie', url: 'https://www.janvaneyck.nl/applications/' },
  { sourceName: 'Akademie Schloss Solitude', url: 'https://www.akademie-solitude.de/en/fellowship/open-call/' },
  { sourceName: 'Camargo Foundation', url: 'https://camargofoundation.org/programs/' },
  { sourceName: 'Casa de Velázquez', url: 'https://www.casadevelazquez.org/en/' },
  { sourceName: 'Fondazione Antonio Ratti', url: 'https://www.fondazioneratti.org/en/' },
  { sourceName: 'WIELS Residencies', url: 'https://www.wiels.org/en/residencies' },
  { sourceName: 'Villa Arson Residencies', url: 'https://www.villa-arson.fr/residences' },
  // USA & Canada
  { sourceName: 'National Endowment for the Arts', url: 'https://www.arts.gov/grants' },
  { sourceName: 'National Endowment for the Humanities', url: 'https://www.neh.gov/grants' },
  { sourceName: 'New York State Council on the Arts', url: 'https://arts.ny.gov/funding-opportunities' },
  { sourceName: 'California Arts Council Grants', url: 'https://arts.ca.gov/grants/' },
  { sourceName: 'MacDowell Residency', url: 'https://www.macdowell.org/apply' },
  { sourceName: 'Yaddo Residencies', url: 'https://yaddo.org/apply/' },
  { sourceName: 'Headlands Center for the Arts', url: 'https://www.headlands.org/programs/' },
  { sourceName: 'Skowhegan School of Painting & Sculpture', url: 'https://www.skowheganart.org/programs' },
  { sourceName: 'Vermont Studio Center', url: 'https://vermontstudiocenter.org/residencies/' },
  { sourceName: 'Anderson Ranch Arts Center', url: 'https://www.andersonranch.org/residencies/' },
  { sourceName: 'Ucross Foundation', url: 'https://ucross.org/residency/' },
  { sourceName: 'Virginia Center for the Creative Arts', url: 'https://www.vcca.com/apply/' },
  { sourceName: 'Millay Arts', url: 'https://www.millayarts.org/residency-program' },
  { sourceName: 'Creative Capital', url: 'https://creative-capital.org/funding-creativity/' },
  { sourceName: 'Pollock-Krasner Foundation', url: 'https://pkf.org/apply/' },
  { sourceName: 'Joan Mitchell Foundation', url: 'https://joanmitchellfoundation.org/artist-programs' },
  { sourceName: 'Foundation for Contemporary Arts', url: 'https://www.foundationforcontemporaryarts.org/' },
  { sourceName: 'Fulbright Program', url: 'https://us.fulbrightonline.org/' },
  { sourceName: 'National Park Service AIR', url: 'https://www.nps.gov/subjects/arts/air.htm' },
  { sourceName: 'Canada Council for the Arts', url: 'https://canadacouncil.ca/funding/grants' },
  { sourceName: 'Ontario Arts Council', url: 'https://www.arts.on.ca/grants' },
  { sourceName: 'British Columbia Arts Council', url: 'https://www.bcartscouncil.ca/programs/' },
  { sourceName: 'Banff Centre Programs', url: 'https://www.banffcentre.ca/programs' },
  { sourceName: 'CALQ Grants', url: 'https://www.calq.gouv.qc.ca/en/grants/' },
  // Latin America
  { sourceName: 'FONCA Mexico', url: 'https://fonca.cultura.gob.mx/' },
  { sourceName: 'Casa Wabi', url: 'https://casawabi.org/' },
  { sourceName: 'Museo Tamayo', url: 'https://museotamayo.org/' },
  { sourceName: 'Fundación Proa', url: 'https://www.proa.org/eng/artists-residency.php' },
  { sourceName: 'MALBA', url: 'https://www.malba.org.ar/' },
  { sourceName: 'FAAP Residency', url: 'https://www.faap.br/residenciaartistica/' },
  { sourceName: 'Pivô Residencies', url: 'https://www.pivo.org.br/en/' },
  { sourceName: 'Flora ars+natura', url: 'https://arteflora.org/en/residencies/' },
  // Asia-Pacific
  { sourceName: 'Japan Foundation Programs', url: 'https://www.jpf.go.jp/e/program/' },
  { sourceName: 'Arts Council Tokyo', url: 'https://www.artscouncil-tokyo.jp/en/what-we-do/support-program/' },
  { sourceName: 'Tokyo Arts and Space', url: 'https://www.tokyoartsandspace.jp/en/' },
  { sourceName: 'Kyoto Art Center', url: 'https://www.kac.or.jp/en/' },
  { sourceName: 'Villa Kujoyama', url: 'https://www.villakujoyama.jp/' },
  { sourceName: 'Youkobo Art Space', url: 'https://www.youkobo.co.jp/en/' },
  { sourceName: 'Red Gate Gallery Residency', url: 'https://redgategallery.com/residency/' },
  { sourceName: 'OCAT', url: 'https://www.ocat.org.cn/' },
  { sourceName: 'Swatch Art Peace Hotel', url: 'https://www.swatch-art-peace-hotel.com/' },
  { sourceName: 'Asia Culture Center', url: 'https://www.acc.go.kr/en/' },
  { sourceName: 'Seoul Museum of Art', url: 'https://sema.seoul.go.kr/' },
  { sourceName: 'Gwangju Biennale Foundation', url: 'http://www.gwangjubiennale.org/' },
  { sourceName: 'Taipei Artist Village', url: 'https://www.artistvillage.org/' },
  { sourceName: 'National Culture and Arts Foundation Taiwan', url: 'https://www.ncafroc.org.tw/' },
  { sourceName: 'Khoj International Artists’ Association', url: 'https://www.khojworkshop.org/' },
  { sourceName: 'FICA India', url: 'https://www.contemporaryindianart.com/' },
  // Middle East & Africa
  { sourceName: 'Sharjah Art Foundation', url: 'https://sharjahart.org/' },
  { sourceName: 'Art Dubai', url: 'https://artdubai.ae/' },
  { sourceName: 'Alserkal Avenue', url: 'https://alserkal.online/' },
  { sourceName: 'Arab Fund for Arts and Culture', url: 'https://www.arabculturefund.org/Programs' },
  { sourceName: 'Al Mawred Al Thaqafy', url: 'https://mawred.org/programs-and-activities/' },
  { sourceName: 'Ashkal Alwan', url: 'https://ashkalalwan.org/programs' },
  { sourceName: 'Mathaf: Arab Museum of Modern Art', url: 'https://www.mathaf.org.qa/' },
  { sourceName: 'Qatar Museums', url: 'https://www.qm.org.qa/en/programs' },
  { sourceName: 'Fire Station Artist in Residence Doha', url: 'https://www.firestationartistinresidence.com/' },
  { sourceName: 'Sursock Museum', url: 'https://www.sursock.museum/' },
  { sourceName: 'Artport Tel Aviv', url: 'https://www.artport.co.il/' },
  { sourceName: 'Townhouse Gallery', url: 'http://www.thetownhousegallery.com/' },
  { sourceName: 'Medrar for Contemporary Art', url: 'https://medrar.org/' },
  { sourceName: 'Greatmore Studios', url: 'https://www.greatmorestudios.com/' },
  { sourceName: 'Bag Factory Artists’ Studios', url: 'https://bagfactoryart.org.za/' },
  // Oceania
  { sourceName: 'Creative New Zealand', url: 'https://creativenz.govt.nz/' },
  { sourceName: 'Australia Council for the Arts', url: 'https://australiacouncil.gov.au/' },
  { sourceName: 'ACCA Melbourne', url: 'https://acca.melbourne/' },
  { sourceName: 'Art Gallery of NSW', url: 'https://www.artgallery.nsw.gov.au/' },
  { sourceName: 'Auckland Art Gallery', url: 'https://www.aucklandartgallery.com/' },
  // International programmes
  { sourceName: 'Pro Helvetia', url: 'https://prohelvetia.ch/en/' },
  { sourceName: 'Prince Claus Fund', url: 'https://princeclausfund.org/open-calls' },
  { sourceName: 'Asian Cultural Council', url: 'https://www.asianculturalcouncil.org/programs/' },
  { sourceName: 'Triangle Network', url: 'https://www.trianglenetwork.org/' },
  { sourceName: 'Creative Europe Culture', url: 'https://culture.ec.europa.eu/funding' },
  { sourceName: 'Fluxus Art Projects', url: 'https://www.fluxusartprojects.com/open-call' },
];

const INSTITUTION_SEARCH_CONFIGS: InstitutionSearchConfig[] = [
  // UK & Ireland
  {
    institution: 'Arts Council England',
    queries: ['Arts Council England open funding 2026', 'ACE DYCP deadline'],
    domains: ['artscouncil.org.uk'],
  },
  {
    institution: 'Creative Scotland',
    queries: ['Creative Scotland open fund deadlines', 'Creative Scotland funding opportunities'],
    domains: ['creativescotland.com'],
  },
  {
    institution: 'Arts Council Wales',
    queries: ['Arts Council Wales funding 2026', 'Wales arts international grants'],
    domains: ['arts.wales', 'wai.org.uk'],
  },
  {
    institution: 'Arts Council Northern Ireland',
    queries: ['Arts Council NI funding opportunities', 'ACNI grants deadline'],
    domains: ['artscouncil-ni.org'],
  },
  {
    institution: 'Arts Council Ireland',
    queries: ['Arts Council Ireland funding deadlines', 'Arts Council Ireland bursary'],
    domains: ['artscouncil.ie'],
  },
  {
    institution: 'Paul Hamlyn Foundation',
    queries: ['Paul Hamlyn Awards for Artists', 'PHF arts fund deadline'],
    domains: ['phf.org.uk'],
  },
  {
    institution: 'Wellcome Trust Arts',
    queries: ['Wellcome Trust arts health deadline', 'Wellcome Trust creative grants'],
    domains: ['wellcome.org'],
  },
  {
    institution: 'Delfina Foundation',
    queries: ['Delfina Foundation residency open call', 'Delfina MENA programme'],
    domains: ['delfinafoundation.com'],
  },
  {
    institution: 'Gasworks Residencies',
    queries: ['Gasworks residencies open call', 'Gasworks London residency deadline'],
    domains: ['gasworks.org.uk'],
  },
  {
    institution: 'Rijksakademie Residency',
    queries: ['Rijksakademie residency open call 2026', 'Rijksakademie application deadline'],
    domains: ['rijksakademie.nl'],
  },
  {
    institution: 'Akademie Schloss Solitude',
    queries: ['Akademie Schloss Solitude fellowship', 'Solitude residency open call'],
    domains: ['akademie-solitude.de'],
  },
  {
    institution: 'Jan van Eyck Academie',
    queries: ['Jan van Eyck residency application', 'Jan van Eyck call 2026'],
    domains: ['janvaneyck.nl'],
  },
  // North America
  {
    institution: 'National Endowment for the Arts',
    queries: ['NEA grants open call', 'National Endowment arts deadline'],
    domains: ['arts.gov'],
  },
  {
    institution: 'National Endowment for the Humanities',
    queries: ['NEH grants deadline', 'National Endowment humanities funding'],
    domains: ['neh.gov'],
  },
  {
    institution: 'Creative Capital',
    queries: ['Creative Capital award cycle', 'Creative Capital application'],
    domains: ['creative-capital.org'],
  },
  {
    institution: 'Pollock-Krasner Foundation',
    queries: ['Pollock Krasner grant application', 'Pollock Krasner deadline'],
    domains: ['pkf.org'],
  },
  {
    institution: 'Joan Mitchell Foundation',
    queries: ['Joan Mitchell fellowship', 'Joan Mitchell grants deadline'],
    domains: ['joanmitchellfoundation.org'],
  },
  {
    institution: 'MacDowell',
    queries: ['MacDowell residency deadline', 'MacDowell fellowship apply'],
    domains: ['macdowell.org'],
  },
  {
    institution: 'Yaddo',
    queries: ['Yaddo residency application', 'Yaddo deadline 2026'],
    domains: ['yaddo.org'],
  },
  {
    institution: 'Headlands Center for the Arts',
    queries: ['Headlands residency open call', 'Headlands AIR deadline'],
    domains: ['headlands.org'],
  },
  {
    institution: 'Skowhegan',
    queries: ['Skowhegan 2026 application', 'Skowhegan residency deadline'],
    domains: ['skowheganart.org'],
  },
  {
    institution: 'Vermont Studio Center',
    queries: ['VSC residency scholarship', 'Vermont Studio Center deadlines'],
    domains: ['vermontstudiocenter.org'],
  },
  {
    institution: 'Anderson Ranch Arts Center',
    queries: ['Anderson Ranch residency open call', 'Anderson Ranch fellowship'],
    domains: ['andersonranch.org'],
  },
  {
    institution: 'Canada Council for the Arts',
    queries: ['Canada Council grant deadline', 'Canada Council arts funding'],
    domains: ['canadacouncil.ca'],
  },
  {
    institution: 'Ontario Arts Council',
    queries: ['Ontario Arts Council grants', 'OAC deadline'],
    domains: ['arts.on.ca'],
  },
  {
    institution: 'FONCA Mexico',
    queries: ['FONCA convocatoria 2025 artes', 'FONCA grants visual art'],
    domains: ['fonca.cultura.gob.mx'],
  },
  {
    institution: 'Casa Wabi',
    queries: ['Casa Wabi residency open call', 'Casa Wabi Oaxaca residency'],
    domains: ['casawabi.org'],
  },
  // Asia-Pacific
  {
    institution: 'Japan Foundation',
    queries: ['Japan Foundation art residency', 'Japan Foundation grant programme'],
    domains: ['jpf.go.jp'],
  },
  {
    institution: 'Tokyo Arts and Space',
    queries: ['TOKAS residency open call', 'Tokyo Arts Space deadline'],
    domains: ['tokyoartsandspace.jp'],
  },
  {
    institution: 'Villa Kujoyama',
    queries: ['Villa Kujoyama residency 2026', 'Villa Kujoyama application'],
    domains: ['villakujoyama.jp'],
  },
  {
    institution: 'Red Gate Gallery Residency',
    queries: ['Red Gate residency Beijing', 'Red Gate open call'],
    domains: ['redgategallery.com'],
  },
  {
    institution: 'Seoul Museum of Art',
    queries: ['SeMA residency open call', 'Seoul Museum of Art residency'],
    domains: ['sema.seoul.go.kr'],
  },
  {
    institution: 'Asia Culture Center',
    queries: ['Asia Culture Center residency', 'ACC residency application'],
    domains: ['acc.go.kr'],
  },
  // Middle East & Africa
  {
    institution: 'Sharjah Art Foundation',
    queries: ['Sharjah Art Foundation grants', 'Sharjah residency application'],
    domains: ['sharjahart.org'],
  },
  {
    institution: 'Arab Fund for Arts and Culture',
    queries: ['AFAC open call 2026', 'Arab Fund arts grant'],
    domains: ['arabculturefund.org'],
  },
  {
    institution: 'Al Mawred Al Thaqafy',
    queries: ['Mawred grants arts', 'Al Mawred open call'],
    domains: ['mawred.org'],
  },
  {
    institution: 'Ashkal Alwan',
    queries: ['Ashkal Alwan residency', 'Ashkal Alwan grant'],
    domains: ['ashkalalwan.org'],
  },
  {
    institution: 'Qatar Museums / Fire Station',
    queries: ['Fire Station Doha residency', 'Qatar Museums artist residency'],
    domains: ['firestationartistinresidence.com', 'qm.org.qa'],
  },
  {
    institution: 'Greatmore Studios',
    queries: ['Greatmore Studios residency', 'Greatmore call'],
    domains: ['greatmorestudios.com'],
  },
  {
    institution: 'Bag Factory Artists’ Studios',
    queries: ['Bag Factory residency open call', 'Bag Factory artist grant'],
    domains: ['bagfactoryart.org.za'],
  },
  // International programmes
  {
    institution: 'Pro Helvetia',
    queries: ['Pro Helvetia residency', 'Pro Helvetia call'],
    domains: ['prohelvetia.ch'],
  },
  {
    institution: 'Prince Claus Fund',
    queries: ['Prince Claus Fund open call', 'Prince Claus mobility'],
    domains: ['princeclausfund.org'],
  },
  {
    institution: 'Asian Cultural Council',
    queries: ['Asian Cultural Council grant', 'ACC fellowship deadline'],
    domains: ['asianculturalcouncil.org'],
  },
  {
    institution: 'Creative Europe Culture',
    queries: ['Creative Europe culture call', 'Creative Europe cooperation project deadline'],
    domains: ['culture.ec.europa.eu', 'ec.europa.eu'],
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


