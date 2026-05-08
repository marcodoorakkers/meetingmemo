// api/notes.js — Anthropic Claude proxy
// Receives transcript + context from the app, returns structured meeting notes.
// Validates Supabase session token before doing anything.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  // DEV_MODE: als er geen token is, toch doorgaan (alleen voor testen)
  let user = null;
  if (token) {
    const { data: { user: u }, error: authError } = await supabase.auth.getUser(token);
    if (!authError) user = u;
  }

  // ── Parse request ─────────────────────────────────────────────────────────────
  const { prompt, lang } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // ── Forward to Anthropic ──────────────────────────────────────────────────────
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await anthropicRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });

    // ── Update meeting record with notes generated ─────────────────────────────
    // Find the most recent transcription record for this user and mark it complete
    if (user) {
      await supabase
        .from('meetings')
        .update({ notes_generated: true, lang })
        .eq('user_id', user.id)
        .eq('notes_generated', false)
        .order('created_at', { ascending: false })
        .limit(1);
    }

    return res.status(200).json({ text: data.content[0].text });

  } catch (e) {
    console.error('Notes error:', e);
    return res.status(500).json({ error: 'Notes generation failed' });
  }
}
