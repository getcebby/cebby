// Synthetic Luma pages shared by the Luma tests.

/** A page carrying `nextData` as its __NEXT_DATA__ blob, the way Luma serves it. */
export function nextDataPage(nextData: { pageProps: Record<string, unknown> }): string {
    return [
        '<!DOCTYPE html><html><head></head><body>',
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: nextData })}</script>`,
        '</body></html>',
    ].join('');
}
