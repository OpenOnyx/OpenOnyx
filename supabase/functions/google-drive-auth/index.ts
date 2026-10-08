import { createEncryptedBroker } from './transport.ts';
import { createGoogleDriveBroker } from './handler.ts';

// Service-role credentials and Google secrets exist only in the Edge runtime.
const allow = async (key: string, limit: number) => {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return false;
    const response = await fetch(`${url}/rest/v1/rpc/google_drive_broker_rate_limit`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_bucket_key: key, p_max_requests: limit }),
    });
    if (!response.ok) throw new Error('Rate limiter unavailable');
    return await response.json() === true;
};
const handler = createGoogleDriveBroker({
  config: {
    clientId: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID') || '',
    clientSecret: Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET') || '',
    signingKey: Deno.env.get('GOOGLE_DRIVE_BROKER_SIGNING_KEY') || '',
  },
  allow,
});
Deno.serve(createEncryptedBroker(handler, Deno.env.get('GOOGLE_DRIVE_BROKER_TRANSPORT_KEY') || '', allow));
