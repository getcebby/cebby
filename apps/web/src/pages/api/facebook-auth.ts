import createClient from "@/utils/supabase/api";
import { NextApiRequest, NextApiResponse } from "next";
import { AccountsFromDB } from "@/types";

const appId = process.env.FACEBOOK_APP_ID || "520608954016953";
const appSecret = process.env.FACEBOOK_APP_SECRET;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const { accessToken } = req.body;
    console.log("🚀 ~ accessToken:", accessToken);

    try {
      const allAccountsData = [];

      let nextPageUrl = `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`;

      while (nextPageUrl) {
        const accountsResponse = await fetch(nextPageUrl);
        const accountsData = await accountsResponse.json();

        if (accountsData.data) {
          allAccountsData.push(...accountsData.data);
        }

        // Check for pagination
        nextPageUrl = accountsData.paging?.cursors?.after
          ? `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}&after=${accountsData.paging.cursors.after}`
          : "";
      }
      console.log("🚀 ~ allAccountsData:", allAccountsData);

      // Fetch page access tokens and add them to allAccountsData
      const allAccountsDataWithTokens: FacebookAccountDataWithPageAccessToken[] =
        await Promise.all(
          allAccountsData.map(async (account) => {
            const longLivedAccessTokenResponse = await fetch(
              `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${account.access_token}`
            );
            const longLivedAccessTokenData =
              await longLivedAccessTokenResponse.json();
            console.log(
              "🚀 ~ allAccountsData.map ~ longLivedAccessTokenData:",
              longLivedAccessTokenData
            );

            // Add the page access token to the account data
            return {
              ...account,
              page_access_token: longLivedAccessTokenData.access_token,
            };
          })
        );

      // Save data to Supabase
      const supabase = createClient(req, res);
      const { data, error } = await supabase
        .from("accounts")
        .upsert(mapAccountsData(allAccountsDataWithTokens), {
          onConflict: "account_id",
        });
      console.log("🚀 ~ data:", data);

      if (error) throw error;

      res.status(200).json({ success: true, message: "Accounts added" });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({
        success: false,
        error: "An error occurred while processing your request.",
      });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

interface FacebookAccountData {
  access_token: string;
  category: string;
  category_list: {
    data: {
      id: string;
      name: string;
    }[];
  };
  id: string;
  name: string;
  tasks: string[];
}
[];

type FacebookAccountDataWithPageAccessToken = FacebookAccountData & {
  page_access_token: string;
};

function mapAccountsData(
  accountsData: FacebookAccountDataWithPageAccessToken[]
): Omit<AccountsFromDB, "id">[] {
  return accountsData.map((account) => ({
    account_id: Number(account.id),
    access_token: account.access_token,
    name: account.name,
    page_access_token: account.page_access_token,
  }));
}
