import type { SupabaseClient } from "@supabase/supabase-js";

const retired = () => { throw new Error("The dancer commission program has ended."); };

export async function createDancerConnectOnboarding(_client: SupabaseClient, _userId: string, _returnUrl: string, _refreshUrl: string) { return retired(); }
export async function requestDancerCashOut(_client: SupabaseClient, _userId: string, _requestKey: string) { return retired(); }
export async function refreshDancerConnectAccount(_client: SupabaseClient, _userId: string) { return null; }
