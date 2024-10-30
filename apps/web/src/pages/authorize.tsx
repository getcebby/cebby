import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Authorize() {
  const [isChecked, setIsChecked] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const clientId = process.env.FACEBOOK_APP_ID || "520608954016953";
    const redirectUri = `${window.location.origin}/authorize`;
    const scope =
      "email,pages_show_list,public_profile,page_events,pages_manage_posts,pages_read_engagement";

    const url = `https://www.facebook.com/v11.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=token`;
    setAuthUrl(url);

    // Check if there's an access token in the URL fragment
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");

    if (accessToken) {
      handleAccessToken(accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAccessToken = async (accessToken: string) => {
    setIsLoading(true); // Set loading to true when the request starts
    try {
      const response = await fetch("/api/facebook-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accessToken }),
      });
      const data = await response.json();

      if (data.success) {
        router.push({
          pathname: "/authorize/success",
          query: { details: JSON.stringify(data.data) },
        });
      } else {
        console.error("Error saving account:", data.error);
        router.push({
          pathname: "/authorize/error",
          query: { message: data.error },
        });
      }
    } catch (error) {
      console.error("Error:", error);
      router.push({
        pathname: "/authorize/error",
        query: { message: "An unexpected error occurred. Please try again." },
      });
    } finally {
      setTimeout(() => {
        setIsLoading(false); // Set loading to false when the request completes
      }, 1000);
    }
  };

  const handleAuthorize = () => {
    window.location.href = authUrl;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-12">
      {isLoading ? (
        <>
          <div className="w-full max-w-2xl text-center">
            <h1 className="text-3xl font-bold mb-4 text-center">
              Just a sec...
            </h1>
            <p className="mb-6 text-center text-gray-500">
              We are processing your request. This may take a few seconds.
            </p>
          </div>
          <button
            className="text-sm mt-2 text-gray-500 absolute bottom-5"
            onClick={() => router.push("/")}
          >
            Click here to go back if nothing happens...
          </button>
        </>
      ) : (
        <>
          <div className="w-full max-w-2xl text-center">
            <span className="bg-yellow-200 text-yellow-800 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded">
              App Verification in progress. Come back later in a bit...
            </span>
            <h1 className="mt-2 text-3xl font-bold mb-4 text-center">
              Authorize CebEvents FB App
            </h1>

            <p className="mt-2 mb-6 text-center">
              By authorizing our app, you allow us to manage and retrieve events
              from your pages, which helps us keep your event information
              up-to-date and accurate in this app and our database.
            </p>
            <div className="my-6 text-center">
              <label className="inline-flex items-center">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  onChange={(e) => setIsChecked(e.target.checked)}
                />
                <span className="ml-2">I am ready to proceed...</span>
              </label>
            </div>
            <div className="flex justify-center">
              <button
                onClick={handleAuthorize}
                className={`px-4 py-2 rounded-lg text-white ${isChecked ? "bg-blue-500" : "bg-gray-400 cursor-not-allowed"}`}
                // disabled={!isChecked || isLoading} // Disable button when loading
              >
                Begin Authorization
              </button>
            </div>
          </div>
          <button
            className="text-sm mt-2 text-gray-500 absolute bottom-5"
            onClick={() => router.push("/")}
          >
            Click here to go back
          </button>
        </>
      )}
    </div>
  );
}
