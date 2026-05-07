// api/transcribe.js — Whisper proxy
// Receives audio from the app, forwards to OpenAI, returns transcript.
// Validates Supabase session token before doing anything.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key — only used server-side
);

export const config = { api: { bodyParser: false } };  // we parse the multipart stream ourselves

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: validate Supabase JWT ───────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  // ── Usage check: enforce per-user monthly limit ───────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count } = await supabase
    .from('meetings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', monthStart);

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  const limit = profile?.plan === 'pro' ? 999 : parseInt(process.env.FREE_TIER_LIMIT || '5');
  if (count >= limit) {
    return res.status(402).json({
      error: 'monthly_limit_reached',
      used: count,
      limit,
      plan: profile?.plan || 'free'
    });
  }

  // ── Forward audio to Whisper ──────────────────────────────────────────────────
  try {
    // Collect raw body (multipart/form-data)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

   // Rebuild as proper FormData so Whisper gets the right filename + type
const { FormData, Blob } = await import('node:buffer').then(() => globalThis);
const audioBlob = new Blob([body], { type: 'audio/webm' });
const form = new FormData();
form.append('file', audioBlob, 'recording.webm');
form.append('model', 'whisper-1');

const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: form,
});

    const data = await whisperRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    // ── Log meeting usage to Supabase ─────────────────────────────────────────
    await supabase.from('meetings').insert({
      user_id: user.id,
      type: 'transcription',
      duration_seconds: null,   // app can send this later if needed
    });

    return res.status(200).json({ text: data.text });

  } catch (e) {
    console.error('Transcribe error:', e);
    return res.status(500).json({ error: 'Transcription failed' });
  }
}
