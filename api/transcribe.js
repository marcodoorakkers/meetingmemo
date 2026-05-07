// api/transcribe.js — Whisper proxy
import { createClient } from '@supabase/supabase-js';
 
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
 
export const config = { api: { bodyParser: false } };
 
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  // ── Auth ──────────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
 
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });
 
  // ── Usage check ───────────────────────────────────────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count } = await supabase
    .from('meetings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', monthStart);
 
  const { data: profile } = await supabase
    .from('profiles').select('plan').eq('id', user.id).single();
 
  const limit = profile?.plan === 'pro' ? 999 : parseInt(process.env.FREE_TIER_LIMIT || '5');
  if (count >= limit) {
    return res.status(402).json({ error: 'monthly_limit_reached', used: count, limit, plan: profile?.plan || 'free' });
  }
 
  // ── Collect raw body ──────────────────────────────────────────────────────────
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);
 
    // Detect format from Content-Type header sent by the browser
    const contentType = req.headers['content-type'] || '';
    let ext = 'webm';
    let mimeType = 'audio/webm';
    if (contentType.includes('mp4') || contentType.includes('m4a')) { ext = 'mp4'; mimeType = 'audio/mp4'; }
    else if (contentType.includes('ogg'))  { ext = 'ogg';  mimeType = 'audio/ogg'; }
    else if (contentType.includes('wav'))  { ext = 'wav';  mimeType = 'audio/wav'; }
 
    // Build a clean multipart/form-data body manually
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const CRLF = '\r\n';
 
    const partHeader = Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="recording.${ext}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    const modelPart = Buffer.from(
      `${CRLF}--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
      `whisper-1${CRLF}` +
      `--${boundary}--${CRLF}`
    );
 
    const multipartBody = Buffer.concat([partHeader, audioBuffer, modelPart]);
 
    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });
 
    const data = await whisperRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
 
    // ── Log usage ─────────────────────────────────────────────────────────────
    await supabase.from('meetings').insert({ user_id: user.id, type: 'transcription', lang: null });
 
    return res.status(200).json({ text: data.text });
 
  } catch (e) {
    console.error('Transcribe error:', e);
    return res.status(500).json({ error: 'Transcription failed: ' + e.message });
  }
}  method: 'POST',
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
