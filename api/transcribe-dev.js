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
    const audioBuffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || 'audio/webm';
    let ext = 'webm';
    if (contentType.includes('mp4'))      ext = 'mp4';
    else if (contentType.includes('ogg')) ext = 'ogg';

    const boundary = '----Boundary' + Math.random().toString(36).slice(2);
    const CRLF = '\r\n';
    const head = Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="recording.${ext}"${CRLF}` +
      `Content-Type: ${contentType.split(';')[0]}${CRLF}${CRLF}`
    );
    const tail = Buffer.from(
      `${CRLF}--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
      `whisper-1${CRLF}--${boundary}--${CRLF}`
    );

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.concat([head, audioBuffer, tail]),
    });

    const data = await whisperRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    return res.status(200).json({ text: data.text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
