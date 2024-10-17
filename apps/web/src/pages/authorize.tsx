import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Authorize() {
  const [authUrl, setAuthUrl] = useState("");
  const router = useRouter();

  useEffect(() => {
    // Replace with your Facebook app's client ID and redirect URI
    const clientId = "520608954016953";
    const redirectUri = "http://localhost:3000/authorize";
    const scope = "email,pages_show_list,page_events,public_profile";

    const url = `https://www.facebook.com/v11.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=token`;
    setAuthUrl(url);
  }, []);

  const handleAuthorize = () => {
    router.push(authUrl);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1 className="text-3xl font-bold mb-4">Authorize Facebook App</h1>
      <p className="mb-4">
        Click the button below to authorize our Facebook app to access your
        pages.
      </p>
      <button
        onClick={handleAuthorize}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg"
      >
        Authorize
      </button>
    </div>
  );
}
