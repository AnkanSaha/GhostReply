import { WEB_SEARCH_RESULT_COUNT, SCRAPE_MAX_CHARS, SCRAPE_TIMEOUT_MS } from './config.js';

// No API key, no signup, no credit card — a plain GET against DuckDuckGo's server-rendered
// HTML results page (no JS needed to read it, unlike the main site). This is scraping, not
// an official API: DuckDuckGo doesn't sanction it and the markup can change without notice.
// Bing and Google were tried too and dropped: Bing serves a CAPTCHA to a plain HTTP client,
// and Google no longer server-renders results at all for non-JS requests (empty shell page,
// needs a full browser) — neither can work via a simple fetch, so "falling back" to them
// would just be dead code pretending to add redundancy it doesn't have.
// ponytail: HTML-scraped search, same risk class as this project's own WhatsApp automation —
// swap for an official API (Brave, etc.) if this starts breaking or reliability matters more
// than staying key-free.
const DUCKDUCKGO_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/';
const SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&'); // must run last — decoding this first would double-unescape e.g. "&amp;#39;"
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

// DuckDuckGo's HTML results wrap every outbound link in a redirect
// (//duckduckgo.com/l/?uddg=<encoded-real-url>&...) — unwrap it to get the actual target.
function unwrapRedirect(href) {
  const match = href.match(/[?&]uddg=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : href;
}

async function webSearch(query) {
  const url = `${DUCKDUCKGO_HTML_ENDPOINT}?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': SEARCH_USER_AGENT } });
    if (!res.ok) return `Web search failed: HTTP ${res.status}`;

    const html = await res.text();
    const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)];
    const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs)];

    if (!titles.length) return 'No search results found.';

    return titles
      .slice(0, WEB_SEARCH_RESULT_COUNT)
      .map((m, i) => {
        const href = unwrapRedirect(m[1]);
        const title = stripTags(m[2]);
        const snippet = snippets[i] ? stripTags(snippets[i][1]) : '';
        return `${i + 1}. ${title}\n${href}\n${snippet}`;
      })
      .join('\n\n');
  } catch (err) {
    return `Web search failed: ${err.message}`;
  }
}

// Strips <script>/<style>/<head> blocks first (their contents aren't readable page text),
// then every remaining tag, then decodes entities. Not a full HTML parser — good enough
// for "give the model readable text from a page," which tolerates the occasional leftover
// nav/footer fragment.
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|head|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapeUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': SEARCH_USER_AGENT } });
    if (!res.ok) return `Failed to fetch ${url}: HTTP ${res.status}`;
    const text = htmlToText(await res.text());
    return text.length > SCRAPE_MAX_CHARS ? `${text.slice(0, SCRAPE_MAX_CHARS)}…` : text;
  } catch (err) {
    return `Failed to fetch ${url}: ${err.message}`;
  } finally {
    clearTimeout(timeout);
  }
}

// A system-prompt rule ("use web_search for X") is only a request — the model can and does
// ignore it, especially when it feels confident it already knows the answer (that's exactly
// how the CJP/CJI mixup happened). When the user explicitly asks to search, force it instead
// of hoping the model complies: detects the request (English/Banglish/Hinglish loanword
// "search"/"google"/"look up", plus Bengali/Hindi script) and pairs with FORCE_WEB_SEARCH_TOOL_CHOICE.
const EXPLICIT_SEARCH_REGEX = /\b(?:search|google|look\s*(?:it\s*)?up)\b|খুঁজ|সার্চ|खोज|ढूंढ|पता\s*कर/i;

export function wantsForcedSearch(body) {
  return EXPLICIT_SEARCH_REGEX.test(body);
}

// The persona unconditionally says "use scrape_url whenever they send a link" — no keyword
// needed. Relying on the model to recognize scrape-intent wording (e.g. "scrap this site")
// left it free to instead decline as if it were a coding task; a link in the message is
// itself the trigger, so force the tool the same way an explicit search request is forced.
const URL_REGEX = /https?:\/\/\S+/i;

export function containsUrl(body) {
  return URL_REGEX.test(body);
}

// Forces the model to call web_search/scrape_url specifically (not just "any tool") on the
// first turn — same named-tool-choice object shape works unchanged on both Mistral and OpenRouter.
export const FORCE_WEB_SEARCH_TOOL_CHOICE = { type: 'function', function: { name: 'web_search' } };
export const FORCE_SCRAPE_TOOL_CHOICE = { type: 'function', function: { name: 'scrape_url' } };

export const WEB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current information — news, prices, scores, recent events, or anything that might have changed since your training data. Returns result titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrape_url',
      description: "Fetch a specific URL (e.g. one found via web_search) and return its readable text content, for when a search snippet alone isn't enough detail.",
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The full URL to fetch.' } },
        required: ['url'],
      },
    },
  },
];

// Never throws — a broken search/scrape becomes a tool-result string the model reads and
// can react to (e.g. "couldn't find that, try rephrasing"), instead of killing the whole reply.
export async function executeToolCall(call) {
  let args;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return 'Invalid tool arguments — could not parse JSON.';
  }

  try {
    if (call.function.name === 'web_search') return await webSearch(args.query);
    if (call.function.name === 'scrape_url') return await scrapeUrl(args.url);
    return `Unknown tool: ${call.function.name}`;
  } catch (err) {
    return `Tool "${call.function.name}" failed: ${err.message}`;
  }
}
