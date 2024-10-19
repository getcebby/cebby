import { createClient } from "@/utils/supabase/component";
import { useRouter } from "next/router";
import Image from "next/image";
import { EventFromDB } from "../calendar";
import { renderTextWithLineBreaks } from "@/utils/text";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { placeholder } from "@/utils/shimmer";

const supabase = createClient();

export default function EventPage({ event }: { event: EventFromDB }) {
  const router = useRouter();

  if (router.isFallback) {
    return <div>Loading...</div>;
  }

  if (!event) {
    return <div>Event not found</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href="/"
        className="text-blue-500 hover:underline mb-4 inline-block"
      >
        ← Back to all events
      </Link>
      <div className="bg-white shadow overflow-hidden rounded-lg">
        {event.cover_photo && (
          <div className="flex-shrink-0 h-62">
            <div className="h-full w-full relative">
              <div className="absolute top-0 z-[-2] h-screen w-screen bg-neutral-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]"></div>
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
        <div className="px-4 py-5 sm:px-6">
          <h1 className="text-3xl font-bold text-gray-900">{event.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{event.account.name}</p>
          <div className="mt-4 text-sm text-gray-500">
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
          <div className="mt-4">
            <h2 className="text-xl font-semibold text-gray-900">Description</h2>
            <div className="mt-2 text-gray-600">
              {renderTextWithLineBreaks(event.description || "")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function getStaticPaths() {
  const { data: events } = await supabase.from("events").select("id");

  const paths =
    events?.map((event) => ({
      params: { id: event.id.toString() },
    })) || [];

  return { paths, fallback: true };
}

export async function getStaticProps({ params }: { params: { id: string } }) {
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
