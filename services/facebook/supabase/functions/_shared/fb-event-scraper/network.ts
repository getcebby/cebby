// Facebook only includes the full event data for requests that look like a
// browser navigation; some combination of the sec-fetch headers is required.
// Accept-Encoding is left to the runtime so it can decompress the body.
const HEADERS: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.6',
    'cache-control': 'max-age=0',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    'sec-gpc': '1',
    'upgrade-insecure-requests': '1',
    'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
};

export const fetchEvent = async (url: string): Promise<string> => {
    let response: Response;
    try {
        response = await fetch(url, { headers: HEADERS });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Error fetching ${url}: ${reason}`);
    }

    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
            `Error fetching ${url}: HTTP ${response.status}. Make sure the URL is correct and the event is public.`,
        );
    }

    return await response.text();
};
