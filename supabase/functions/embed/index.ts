/// <reference path="../types.d.ts" />
// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from 'npm:openai';
import { requireUser } from '../_shared/requireUser.ts';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { input } = await req.json();

    if (!input || typeof input !== 'string') {
      return new Response(JSON.stringify({ error: 'Valid input string is required' }), { status: 400 });
    }

    // Generate embedding using OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input,
    });

    const embedding = embeddingResponse.data[0].embedding;

    return new Response(JSON.stringify({ embedding }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
