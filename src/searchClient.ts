export interface WebSearchResult {
  name: string;
  url: string;
  snippet?: string;
}

interface SearchApiResponse {
  webPages?: {
    value: Array<{
      name: string;
      url: string;
      snippet?: string;
    }>;
  };
}

const SEARCH_ENDPOINT =
  process.env.SEARCH_API_ENDPOINT ?? 'https://api.bing.microsoft.com/v7.0/search';

const SEARCH_HEADERS = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.SEARCH_API_KEY) {
    headers['Ocp-Apim-Subscription-Key'] = process.env.SEARCH_API_KEY;
  }

  return headers;
};

export async function searchWeb(
  query: string,
  {
    count = 5,
    freshness,
    domains,
  }: { count?: number; freshness?: 'Day' | 'Week' | 'Month'; domains?: string[] } = {},
): Promise<WebSearchResult[]> {
  if (!process.env.SEARCH_API_KEY) {
    console.warn('   ⚠️  SEARCH_API_KEY not configured. Skipping web search.');
    return [];
  }

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('responseFilter', 'Webpages');
  url.searchParams.set('textDecorations', 'false');
  url.searchParams.set('textFormat', 'Raw');
  url.searchParams.set('safeSearch', 'Moderate');

  if (freshness) {
    url.searchParams.set('freshness', freshness);
  }

  if (domains && domains.length > 0) {
    url.searchParams.set('sites', domains.join(','));
  }

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: SEARCH_HEADERS(),
    });

    if (!res.ok) {
      console.error(`   ❌ Search API error ${res.status}: ${res.statusText}`);
      return [];
    }

    const data = (await res.json()) as SearchApiResponse;
    return (
      data.webPages?.value.map((item) => {
        const result: WebSearchResult = {
          name: item.name,
          url: item.url,
        };
        if (item.snippet) {
          result.snippet = item.snippet;
        }
        return result;
      }) ?? []
    );
  } catch (error: any) {
    console.error(`   ❌ Search request failed: ${error.message}`);
    return [];
  }
}


