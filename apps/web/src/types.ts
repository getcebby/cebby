export interface EventFromDB {
  id: string;
  name: string;
  description?: string;
  start_time: string;
  end_time?: string;
  cover_photo?: string;
  source_id: string; // Use this for facebook event id
  account: {
    id: string;
    name: string;
    account_id: number;
  };
  is_featured: boolean;
}

export interface AccountsFromDB {
  id: string;
  name: string;
  account_id: number;
  page_access_token?: string;
  is_active?: boolean;
}
