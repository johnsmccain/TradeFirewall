// In-memory cache so we don't hammer the SoSoValue API on every keystroke.
// Currency list changes rarely — 1 hour TTL is plenty.

interface CurrencyRow {
  symbol: string;
  name: string;
}

let cache: { at: number; data: CurrencyRow[] } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1 hour

async function getCurrencies(): Promise<CurrencyRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const key = process.env.SOSOVALUE_API_KEY || process.env.NEXT_PUBLIC_SOSOVALUE_API_KEY;
  if (!key) throw new Error('SOSOVALUE_API_KEY not set');

  const base = (process.env.SOSOVALUE_API_BASE_URL || 'https://openapi.sosovalue.com/openapi/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/currencies`, {
    headers: { 'x-soso-api-key': key, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`SoSoValue /currencies HTTP ${res.status}`);

  const json = await res.json();
  const rows: CurrencyRow[] = (Array.isArray(json?.data) ? json.data : [])
    .map((r: { symbol?: string; name?: string }) => ({
      symbol: (r.symbol || '').toUpperCase(),
      name: r.name || '',
    }))
    .filter((r: CurrencyRow) => r.symbol.length > 0);

  cache = { at: Date.now(), data: rows };
  return rows;
}

export async function GET() {
  try {
    const currencies = await getCurrencies();
    return Response.json({ currencies });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch currencies' },
      { status: 502 }
    );
  }
}
