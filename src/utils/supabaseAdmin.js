// Server-only Supabase client using the service-role key -- bypasses RLS entirely,
// so this must NEVER be imported by anything that ends up in the browser bundle
// (only api/*.js serverless functions and server-only utils like orderWrite.js).
// SUPABASE_SERVICE_ROLE_KEY is deliberately NOT prefixed REACT_APP_ -- Create
// React App only inlines REACT_APP_* vars into the client bundle at build time,
// so this name is a second, independent guarantee against ever ending up there
// even if a future change accidentally imports this file from client code.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('supabaseAdmin: SUPABASE_SERVICE_ROLE_KEY is not set -- privileged RPC calls will fail.');
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
export default supabaseAdmin;
