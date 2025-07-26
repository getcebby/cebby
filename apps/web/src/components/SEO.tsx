import Head from 'next/head';

interface SEOProps {
    title: string;
    description: string;
    url: string;
    imageUrl: string;
    noindex?: boolean;
}

export const SEO: React.FC<SEOProps> = ({ title, description, url, imageUrl, noindex = false }) => {
    return (
        <Head>
            <title>{title}</title>
            <meta name="description" content={description} />

            {/* Prevent indexing if noindex is true */}
            {noindex && <meta name="robots" content="noindex, nofollow" />}

            {/* Open Graph / Facebook */}
            <meta property="og:type" content="website" />
            <meta property="og:url" content={url} />
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={imageUrl} />

            {/* Twitter */}
            <meta property="twitter:card" content="summary_large_image" />
            <meta property="twitter:url" content={url} />
            <meta property="twitter:title" content={title} />
            <meta property="twitter:description" content={description} />
            <meta property="twitter:image" content={imageUrl} />
        </Head>
    );
};
