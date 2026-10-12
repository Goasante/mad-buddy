import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export function createSupabaseAdminClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(); const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
 if(!url || !key) throw new Error("Private book storage is not configured.");
 return createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
