import { useRouter } from "next/router";

export default function AuthorizeSuccess() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-12">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-3xl font-bold mb-4 text-center text-green-600">
          Authorization Successful!
        </h1>
        <p className="mb-6 text-center">
          Awesome! Your Facebook account has been successfully connected to
          CebEvents.
        </p>
        <p className="mb-6 text-center text-gray-500">
          Please note that events might show up later as we run our automation
          every 15 minutes.
        </p>
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded-lg"
          onClick={() => router.push("/")}
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
