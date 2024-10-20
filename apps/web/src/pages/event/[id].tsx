import Head from "next/head";
import { createClient } from "@/utils/supabase/static-props";
import { useRouter } from "next/router";
import Image from "next/image";
import { EventFromDB } from "../calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { placeholder } from "@/utils/shimmer";
import { motion } from "framer-motion";

const EventPage: React.FC<{ event: EventFromDB }> = ({ event }) => {
  const router = useRouter();

  if (router.isFallback) {
    return <div>Loading...</div>;
  }

  if (!event) {
    return <div>Event not found</div>;
  }

  const title = `${event.name} - CebEvents`;
  const description = event.description
    ? event.description.substring(0, 160)
    : "Join us for this exciting event!";
  const url = `https://events.dorelljames.dev/event/${event.id}`; // Replace with your actual URL structure
  const imageUrl =
    event.cover_photo ||
    "https://events.dorelljames.dev/default-event-image.jpg"; // Use a default image if no cover photo

  const pageVariants = {
    initial: { opacity: 0, y: 20 },
    in: { opacity: 1, y: 0 },
    out: { opacity: 0, y: -20 },
  };

  const pageTransition = {
    type: "tween",
    ease: "anticipate",
    duration: 0.5,
  };

  return (
    <motion.div
      initial="initial"
      animate="in"
      exit="out"
      variants={pageVariants}
      transition={pageTransition}
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12"
    >
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />

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

      <Link
        href="/"
        className="text-blue-500 hover:underline mb-4 inline-block"
        shallow={true}
        scroll={false}
      >
        ← Back to all events
      </Link>
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden rounded-lg">
        {event.cover_photo && (
          <div className="flex-shrink-0 h-62">
            <div className="h-full w-full relative">
              <div className="absolute top-0 z-[-2] h-screen w-screen bg-neutral-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))] dark:bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(0,0,0,0))]"></div>
              <Image
                src={event.cover_photo}
                alt={event.name}
                className="h-full w-full object-contain"
                width={600}
                height={600}
                placeholder={placeholder}
              />
            </div>
          </div>
        )}
        <div className="px-4 py-5 sm:px-6 flex flex-col sm:flex-row justify-between items-start sm:items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {event.name}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {event.account.name}
            </p>
            <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              <time
                dateTime={event.start_time}
                title={new Date(event.start_time).toLocaleString()}
              >
                {formatDistanceToNow(new Date(event.start_time), {
                  addSuffix: true,
                })}{" "}
                · {new Date(event.start_time).toLocaleString()}
              </time>
            </div>
          </div>
          <div className="mt-4 sm:mt-0 sm:ml-4 w-full sm:w-auto">
            <Link
              href={`https://www.facebook.com/events/${event.source_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 border border-transparent text-lg font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <span className="none:md">View event on </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="ml-2 h-5 w-5 mr-2"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M22.675 0h-21.35C.597 0 0 .597 0 1.326v21.348C0 23.403.597 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.794.715-1.794 1.763v2.31h3.587l-.467 3.622h-3.12V24h6.116c.729 0 1.325-.597 1.325-1.326V1.326C24 .597 23.403 0 22.675 0z" />
              </svg>{" "}
              Facebook
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 ml-2"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </Link>
          </div>
        </div>
        <div className="px-4 py-5 sm:px-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Description
          </h2>
          <div className="mt-2 text-gray-600 dark:text-gray-300">
            {renderTextWithLineBreaks(event.description || "")}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default EventPage;

export async function getStaticPaths() {
  const supabase = createClient();
  const { data: events } = await supabase.from("events").select("id");

  const paths =
    events?.map((event) => ({
      params: { id: event.id.toString() },
    })) || [];

  return { paths, fallback: true };
}

export async function getStaticProps({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: event, error } = await supabase
    .from("events")
    .select(
      `
      *,
      account:account_id (
        id,
        name,
        type
      )
    `
    )
    .eq("id", params.id)
    .single();

  if (error || !event) {
    return { notFound: true };
  }

  return { props: { event }, revalidate: 60 };
}
