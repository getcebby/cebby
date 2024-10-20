import { useRouter } from "next/router";

export default function AuthorizeError() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-12">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-3xl font-bold mb-4 text-center text-red-600">
          Authorization Error
        </h1>
        <p className="mb-6 text-center">
          There was an error during the authorization process:
        </p>
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded-lg mr-4"
          onClick={() => router.push("/authorize")}
        >
          Try Again
        </button>
        <button
          className="px-4 py-2 bg-gray-500 text-white rounded-lg"
          onClick={() => router.push("/")}
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
