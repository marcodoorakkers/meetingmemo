// api/transcribe-dev.js — Whisper proxy ZONDER auth (alleen voor testen)
// ⚠️ Verwijder dit bestand of zet DEV_MODE=false voor productie

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const contentType = req.headers['content-type'];

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': contentType,
      },
      body,
    });

    const data = await whisperRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    return res.status(200).json({ text: data.text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
