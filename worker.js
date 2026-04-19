export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ['https://enosil.com', 'https://www.enosil.com', 'https://enosil.github.io'];
    const corsOrigin = allowed.includes(origin) ? origin : allowed[0];

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin,
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type' },
      });
    }

    try {
      // Primary: scrape the APOD page directly (NASA API is unreliable)
      const data = await scrapeAPOD();

      // Fallback: if scraping fails, try the API
      if (!data.title && env.NASA_API_KEY) {
        const apiRes = await fetch('https://api.nasa.gov/planetary/apod?api_key=' + env.NASA_API_KEY);
        if (apiRes.ok) {
          const apod = await apiRes.json();
          if (apod.title) {
            const fallback = {
              title: apod.title || '',
              date: apod.date || '',
              explanation: apod.explanation || '',
              media_type: apod.media_type || 'image',
              url: apod.url || '',
              service_version: 'v1',
            };
            if (apod.hdurl) fallback.hdurl = apod.hdurl;
            if (apod.copyright) fallback.copyright = apod.copyright;

            return new Response(JSON.stringify(fallback), {
              headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' },
            });
          }
        }
      }

      // Only cache successful responses — don't lock in empty/broken data
      const cacheHeader = data.title
        ? 'public, max-age=3600'
        : 'no-store';

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Cache-Control': cacheHeader },
      });
    } catch (err) {
      return new Response(JSON.stringify({ code: 500, msg: 'Failed: ' + err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};

async function scrapeAPOD() {
  const res = await fetch('https://apod.nasa.gov/apod/astropix.html', { cf: { cacheTtl: 600 } });
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Detect encoding: if most odd bytes are 0x00, it's UTF-16LE (ASCII with null padding)
  let nullCount = 0;
  const check = Math.min(bytes.length, 200);
  for (let i = 1; i < check; i += 2) {
    if (bytes[i] === 0) nullCount++;
  }
  const isUTF16 = nullCount > check / 4;

  let html;
  if (isUTF16) {
    html = new TextDecoder('utf-16le').decode(buffer);
  } else {
    html = new TextDecoder('utf-8').decode(buffer);
  }
  html = html.replace(/\u0000/g, '');

  // Date and title from <title> tag: "APOD: 2026 April 8 - Title"
  const months = {
    january:'01', february:'02', march:'03', april:'04',
    may:'05', june:'06', july:'07', august:'08',
    september:'09', october:'10', november:'11', december:'12'
  };

  let date = '';
  let title = '';

  const titleTagMatch = html.match(/<title>\s*APOD:\s*(\d{4})\s+(\w+)\s+(\d{1,2})\s*[\s\S]*?[-\u2013\u2014]\s*([\s\S]+?)\s*<\/title>/i);
  if (titleTagMatch) {
    const m = months[titleTagMatch[2].toLowerCase()];
    if (m) date = titleTagMatch[1] + '-' + m + '-' + titleTagMatch[3].padStart(2, '0');
    title = titleTagMatch[4].replace(/\s+/g, ' ').trim();
  }

  // Fallback: grab title from the bold tag after the image/video
  if (!title) {
    const bMatch = html.match(/<center>\s*<b>\s*([\s\S]*?)\s*<\/b>/i);
    if (bMatch) {
      const raw = bMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (raw && !raw.toLowerCase().includes('discover the cosmos')) title = raw;
    }
  }

  // Fallback: grab date from the page if title regex missed it
  if (!date) {
    const dateMatch = html.match(/(\d{4})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
    if (dateMatch) {
      const m = months[dateMatch[2].toLowerCase()];
      if (m) date = dateMatch[1] + '-' + m + '-' + dateMatch[3].padStart(2, '0');
    }
  }

  // Media: check for image first, then video (iframe)
  let media_type = 'image';
  let url = '';
  let hdurl = '';

  const hdMatch = html.match(/<a\s+href="(image\/[^"]+)"/i);
  if (hdMatch) hdurl = 'https://apod.nasa.gov/apod/' + hdMatch[1];

  const imgMatch = html.match(/IMG\s+SRC="(image\/[^"]+)"/i);
  if (imgMatch) url = 'https://apod.nasa.gov/apod/' + imgMatch[1];

  if (!url && !hdurl) {
    const iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
    if (iframeMatch) {
      media_type = 'video';
      url = iframeMatch[1];
      if (url.startsWith('//')) url = 'https:' + url;
    }
  }

  if (!url && hdurl) url = hdurl;
  if (!hdurl && url) hdurl = url;

  // Explanation
  let explanation = '';
  const expMatch = html.match(/Explanation:\s*<\/b>\s*([\s\S]*?)(<p>|<center>)/i);
  if (expMatch) {
    explanation = expMatch[1]
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Copyright
  let copyright = '';
  const creditMatch = html.match(/Credit[^:]*:\s*<\/b>\s*([\s\S]*?)<\/center>/i);
  if (creditMatch) {
    copyright = creditMatch[1]
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const data = { title, date, explanation, media_type, url, service_version: 'v1' };
  if (hdurl && media_type === 'image') data.hdurl = hdurl;
  if (copyright) data.copyright = copyright;

  return data;
}
