// Helpers for putting scraped text into HTML. Event names, descriptions and
// organizer names come from Facebook, Luma, Meetup and Eventbrite pages, so
// treat them as untrusted wherever they reach set:html.

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** Escape text for HTML element content or a quoted attribute value. */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const LINK_CLASS = 'text-purple-700 hover:text-purple-900 underline break-all';

// URLs stop at whitespace, quotes and angle brackets, so a URL can't carry
// markup or break out of the href it's placed in.
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

function linkify(text: string): string {
    let html = '';
    let last = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
        const url = match[0].replace(/[.,;!?]$/, '');
        const start = match.index ?? 0;
        html += escapeHtml(text.slice(last, start));
        html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="${LINK_CLASS}">${escapeHtml(url)}</a>`;
        last = start + url.length;
    }
    return html + escapeHtml(text.slice(last));
}

// Render description as paragraph blocks. Luma's flat description (the
// scraper's fallback path when description_mirror is unavailable) joins
// paragraphs with single \n, which whitespace-pre-wrap renders as tight
// line-breaks with no breathing room. Splitting on \n+ and wrapping each
// chunk in <p> lets Tailwind's space-y-3 give proper paragraph rhythm
// regardless of whether the source used \n or \n\n.
export function renderDescription(text: string): string {
    return text
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${linkify(p)}</p>`)
        .join('');
}

/**
 * JSON for an inline <script> (JSON-LD or a data block). JSON.stringify leaves
 * "<" as is, so scraped text containing "</script>" would close the tag. The
 * \u escapes keep the output valid JSON for JSON.parse and JSON-LD readers.
 */
export function jsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
