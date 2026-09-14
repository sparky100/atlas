/**
 * Sprint F7 item 1: the first edge function this repo has ever shipped —
 * this file is shared scaffolding for every function that follows, not
 * something specific to invite emails. `supabase.functions.invoke(...)`
 * (`src/db/invites.ts`'s `sendInviteEmail`) issues a real browser fetch
 * against the function's own URL, which needs the standard CORS preflight
 * response before the browser will send the real POST at all.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
