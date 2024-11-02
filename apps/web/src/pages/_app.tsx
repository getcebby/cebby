import "@/styles/globals.css";
import type { AppProps } from "next/app";
import TopBanner from "@/components/TopBanner";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <div
      className={`${
        process.env.NODE_ENV === "development" ? "debug-screens" : undefined
      }`}
    >
      <TopBanner />
      <Component {...pageProps} />
    </div>
  );
}

export default MyApp;
