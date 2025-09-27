export default async function handler(req: any, res: any) {
  const { url } = req.query;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!url) {
    return res.json({ 
      message: 'MultiMovies.mobi Scraper API',
      version: '2.0',
      new_domain: 'multimovies.mobi',
      usage: '/api/getStream?url=MULTIMOVIES_URL',
      example: '/api/getStream?url=https://multimovies.mobi/movie-url'
    });
  }

  // Import and use the getStream handler
  const getStreamHandler = (await import('./getStream')).default;
  return getStreamHandler(req, res);
}
