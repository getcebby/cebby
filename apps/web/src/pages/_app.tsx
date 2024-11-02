import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import TopBanner from "@/components/TopBanner";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="manifest" href="/site.webmanifest" />
      </Head>
      <div
        className={`${
          process.env.NODE_ENV === "development" ? "debug-screens" : undefined
        }`}
      >
        <TopBanner />
        <Component {...pageProps} />
      </div>
    </>
  );
}

export default MyApp;
