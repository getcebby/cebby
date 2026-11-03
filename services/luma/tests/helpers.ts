// Synthetic Luma pages shared by the Luma tests.

/** A page carrying `nextData` as its __NEXT_DATA__ blob, the way Luma serves it. */
export function nextDataPage(nextData: { pageProps: Record<string, unknown> }): string {
    return [
        '<!DOCTYPE html><html><head></head><body>',
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: nextData })}</script>`,
        '</body></html>',
    ].join('');
}

/** Answers each fetch by the first route whose key the URL contains; unrouted URLs get a 599. */
export function routeFetch(routes: Record<string, () => Response>) {
    return (input: string | URL | Request): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const key = Object.keys(routes).find((k) => url.includes(k));
        return Promise.resolve(key ? routes[key]() : new Response('unrouted', { status: 599 }));
    };
}
