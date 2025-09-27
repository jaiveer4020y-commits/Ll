import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;

  if (!url) {
    return res.redirect(302, '/api/getStream?url=' + encodeURIComponent('https://multimovies.online'));
  }

  // Redirect to getStream endpoint
  return res.redirect(302, `/api/getStream?url=${encodeURIComponent(url as string)}`);
}
