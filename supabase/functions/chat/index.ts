// @ts-nocheck
/// <reference path="../types.d.ts" />
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
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Valid messages array is required' }), { status: 400 });
    }

    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o', // Or gpt-3.5-turbo
      messages,
    });

    const reply = chatCompletion.choices[0].message.content;

    return new Response(JSON.stringify({ reply }), {
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
