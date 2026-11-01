/**
 * User-facing mapping for `/api/analyze-trade` failures.
 *
 * This used to be a chain of `error.message.includes(...)` tests in the page component, and the
 * ordering was actively harmful. A missing ticker produces the message
 * "Currency FOO not found in SoSoValue currency list", which contains no capital "Symbol" (so the
 * symbol branch missed it) but does contain "SoSoValue" (so the API-key branch matched). Every
 * typo'd ticker therefore told the user to edit an environment file and restart the dev server.
 * A 429 rate limit landed on the same branch.
 *
 * The server already returns a machine-readable `errorType` on every branch, so that is what this
 * keys off. Kept pure and dependency-free so the mapping can be unit tested directly -- a
 * regression here is invisible to the type checker and only shows up as a wrong message to a user.
 */

export type AnalyzeErrorKind =
  | 'config'
  | 'invalid-input'
  | 'symbol-not-found'
  | 'rate-limited'
  | 'upstream-timeout'
  | 'upstream-unavailable'
  | 'data-unavailable'
  | 'cancelled'
  | 'unknown';

export interface AnalyzeErrorInfo {
  kind: AnalyzeErrorKind;
  /** Primary, actionable, addressed to the person who submitted the trade. */
  message: string;
  /** Optional secondary line. Operator-facing detail is kept out of `message` on purpose. */
  detail?: string;
  /** Whether retrying the same request could plausibly succeed. */
  retryable: boolean;
}

/** Shape of the JSON body the route returns on failure. */
export interface AnalyzeErrorPayload {
  error?: unknown;
  errorType?: unknown;
  suggestion?: unknown;
  /** HTTP status, forwarded by the client since the 400 validation branches send no errorType. */
  status?: unknown;
}

export interface MapAnalyzeErrorOptions {
  /** The symbol the user submitted, so the message can name it instead of quoting raw upstream text. */
  symbol?: string;
  /** The client aborted the request. */
  cancelled?: boolean;
  /** The client-side deadline elapsed. */
  timedOut?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * "FOO" -> `"FOO"`, and degrades gracefully when the symbol is missing or absurdly long, since
 * this string is rendered into a toast.
 */
function quoteSymbol(symbol?: string): string {
  if (!symbol) return 'that symbol';
  const trimmed = symbol.trim().slice(0, 16);
  return trimmed ? `"${trimmed}"` : 'that symbol';
}

type Mapper = (payload: AnalyzeErrorPayload, opts: MapAnalyzeErrorOptions) => AnalyzeErrorInfo;

const CONFIG: Mapper = (payload) => ({
  kind: 'config',
  message:
    'Market data is not connected on this deployment, so no analysis could run. This is a setup problem, not something you can fix from this form.',
  detail: asString(payload.suggestion),
  retryable: false,
});

const SYMBOL_NOT_FOUND: Mapper = (payload, opts) => ({
  kind: 'symbol-not-found',
  message: `We could not find ${quoteSymbol(opts.symbol)} in our market data. Check the ticker spelling, or pick one from the symbol list.`,
  detail: asString(payload.suggestion),
  retryable: false,
});

const RATE_LIMITED: Mapper = (payload) => ({
  kind: 'rate-limited',
  message:
    'Our market data provider is rate limiting requests right now. Wait about a minute and run the analysis again.',
  detail: asString(payload.suggestion),
  retryable: true,
});

const UPSTREAM_TIMEOUT: Mapper = (payload) => ({
  kind: 'upstream-timeout',
  message:
    'A market data provider did not respond in time. This is usually temporary — try again in a moment.',
  detail: asString(payload.suggestion),
  retryable: true,
});

const UPSTREAM_UNAVAILABLE: Mapper = (payload) => ({
  kind: 'upstream-unavailable',
  message:
    'A market data provider is unavailable right now, so this analysis could not be completed. Try again shortly.',
  detail: asString(payload.suggestion),
  retryable: true,
});

const DATA_UNAVAILABLE: Mapper = (payload) => ({
  kind: 'data-unavailable',
  message:
    'Neither market data provider responded, so there is not enough live data to score this trade. Try again shortly.',
  detail: asString(payload.suggestion),
  retryable: true,
});

const INVALID_INPUT: Mapper = (payload) => ({
  kind: 'invalid-input',
  message: asString(payload.error) ?? 'That trade could not be read. Check the symbol, amount, action and holding period.',
  retryable: false,
});

const UNKNOWN: Mapper = (payload) => ({
  kind: 'unknown',
  message: 'The analysis could not be completed. Please try again.',
  // Raw upstream text is the last resort only: it can read as gibberish to a user.
  detail: asString(payload.error),
  retryable: true,
});

const BY_TYPE: Record<string, Mapper> = {
  // Deployment misconfiguration: the server has no provider key. Distinct from every upstream
  // failure below, and the reason the old substring chain mislabelled bad tickers.
  API_CONNECTION_ERROR: CONFIG,
  SOSOVALUE_KEY_MISSING: CONFIG,

  // The symbol is the user's input, so this is the one branch that must never blame the
  // deployment.
  SYMBOL_NOT_FOUND_SOSOVALUE: SYMBOL_NOT_FOUND,
  SYMBOL_NOT_FOUND: SYMBOL_NOT_FOUND,
  SYMBOL_NOT_AVAILABLE_ON_SODEX: SYMBOL_NOT_FOUND,

  // 429s arrive as SOSOVALUE_HTTP_ERROR when the provider does not set a distinct body, so the
  // route also forwards RATE_LIMITED whenever it can see the status.
  RATE_LIMITED: RATE_LIMITED,

  UPSTREAM_TIMEOUT: UPSTREAM_TIMEOUT,
  SOSOVALUE_HTTP_ERROR: UPSTREAM_UNAVAILABLE,
  SOSOVALUE_API_ERROR: UPSTREAM_UNAVAILABLE,
  SODEX_ERROR: UPSTREAM_UNAVAILABLE,
  SODEX_MARKET_ERROR: UPSTREAM_UNAVAILABLE,
  SODEX_MARKETS_UNAVAILABLE: UPSTREAM_UNAVAILABLE,

  INSUFFICIENT_DATA: DATA_UNAVAILABLE,

  // 400s from the route's own validation, which sends no errorType.
  INVALID_TRADE_INPUT: INVALID_INPUT,
  VALIDATION_ERROR: INVALID_INPUT,

  ANALYSIS_ERROR: UNKNOWN,
};

const CLIENT_TIMEOUT: AnalyzeErrorInfo = {
  kind: 'upstream-timeout',
  message:
    'The analysis took too long and was stopped. Market data can be slow to respond — try again.',
  retryable: true,
};

const CLIENT_CANCELLED: AnalyzeErrorInfo = {
  kind: 'cancelled',
  message: 'Analysis cancelled.',
  retryable: true,
};

/**
 * Resolve a failure into something worth showing a user.
 *
 * Prefers the server's `errorType`; falls back to a generic message rather than guessing from the
 * message text, because guessing from text is what produced the original misroute.
 */
export function mapAnalyzeError(
  payload: AnalyzeErrorPayload,
  opts: MapAnalyzeErrorOptions = {}
): AnalyzeErrorInfo {
  // Client-side outcomes are decided before the server ever answers, so they win outright.
  if (opts.cancelled) return CLIENT_CANCELLED;
  if (opts.timedOut) return CLIENT_TIMEOUT;

  const errorType = asString(payload.errorType);
  if (errorType) {
    const mapper = BY_TYPE[errorType];
    if (mapper) return mapper(payload, opts);
  }

  // A 400 with no errorType is the route's own input validation, which is the user's to fix.
  if (payload.status === 400) return INVALID_INPUT(payload, opts);

  return UNKNOWN(payload, opts);
}
