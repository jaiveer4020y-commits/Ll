# Vercel Multimovies Scraper API

This is a simple API hosted on Vercel that extracts **.m3u8 links** from `multimovies.online`.

## 🚀 Deploy

1. Fork this repo and push to your GitHub.
2. Connect it to [Vercel](https://vercel.com).
3. Deploy.

## 🔗 Usage

```
https://your-vercel-app.vercel.app/api/getStream?url=<multimovies-url>
```

Example:

```
https://your-vercel-app.vercel.app/api/getStream?url=https://multimovies.online/movies/example
```

Response:

```json
{
  "server": "Multi",
  "type": "m3u8",
  "link": "https://.../file.m3u8"
}
```