import "@/styles/globals.css";
import type { AppProps } from "next/app";
import TopBanner from "@/components/TopBanner";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <TopBanner />
      <Component {...pageProps} />
    </>
  );
}

export default MyApp;
