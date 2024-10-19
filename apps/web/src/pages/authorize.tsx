import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Authorize() {
  const [authUrl, setAuthUrl] = useState("");
  const router = useRouter();

  useEffect(() => {
    // Replace with your Facebook app's client ID and redirect URI
    const clientId = "520608954016953";
    const redirectUri = `${window.location.origin}/authorize`;
    const scope = "email,pages_show_list,page_events,public_profile";

    const url = `https://www.facebook.com/v11.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=token`;
    setAuthUrl(url);
  }, []);

  const handleAuthorize = () => {
    router.push(authUrl);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-12">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-3xl font-bold mb-4 text-center">
          Authorize Facebook App
        </h1>
        <p className="mb-6 text-center">
          To provide you with the best experience, we need access to your
          Facebook pages. By authorizing our app, you allow us to manage and
          retrieve events from your pages, which helps us keep your event
          information up-to-date and accurate in our database.
        </p>
        <p className="my-6 text-center">
          Click the button below whenever you are ready!
        </p>
        <div className="flex justify-center">
          <button
            onClick={handleAuthorize}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg"
          >
            Begin Authorization
          </button>
        </div>
        <button
          className="text-sm mt-2 text-gray-500"
          onClick={() => router.push("/")}
        >
          Click here to go back
        </button>
      </div>
    </div>
  );
}
