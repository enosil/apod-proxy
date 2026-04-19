# apod-proxy

A Cloudflare Worker that fetches NASA's [Astronomy Picture of the Day](https://apod.nasa.gov/apod/astropix.html) and returns it as JSON.

Scrapes the APOD webpage directly and returns structured JSON with the media URL, title, date, explanation, and copyright info. Supports both image and video (YouTube embed) APOD entries. Falls back to the NASA API if scraping fails.

## JSON response

```json
{
  "title": "Earthset",
  "date": "2026-04-08",
  "explanation": "And to all of you down there...",
  "media_type": "image",
  "url": "https://apod.nasa.gov/apod/image/2604/earthset_700.jpg",
  "hdurl": "https://apod.nasa.gov/apod/image/2604/earthset_original.jpg",
  "copyright": "NASA",
  "service_version": "v1"
}
```

## Setup

1. Create a Worker in Cloudflare dashboard (Workers & Pages → Create)
2. Paste the contents of `worker.js`
3. (Optional) Add your NASA API key as a secret for fallback: Workers → Settings → Variables and Secrets → Add → `NASA_API_KEY`
4. Deploy

## CORS

Requests are restricted to allowed origins defined in the Worker code. Update the `allowed` array to match your domains.

## Caching

Responses are cached for 1 hour (`max-age=3600`). The APOD page updates once daily.
