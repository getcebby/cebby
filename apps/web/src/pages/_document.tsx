import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
    return (
        <Html lang="en">
            <Head>
                <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
                <meta name="robots" content="noindex, nofollow" />
            </Head>
            <body className="antialiased">
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
