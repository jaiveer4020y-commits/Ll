import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing ?url parameter" });
  }

  // Handle array case (when query has multiple `url=`)
  if (Array.isArray(url)) {
    url = url[0];
  }

  // Force to string and normalize
  const targetUrl = decodeURIComponent(url.toString().trim());

  // Validate it’s a proper http/https URL
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: "Invalid ?url parameter", value: targetUrl });
  }

  const headers = {
    "sec-ch-ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    Referer: "https://multimovies.online/",
    "Sec-Fetch-User": "?1",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  };

  try {
    // Step 1: Fetch page
    const resPage = await axios.get(targetUrl, { headers });
    const $ = cheerio.load(resPage.data);

    // Step 2: Find iframe source
    const iframeSrc = $("iframe").attr("src");
    if (!iframeSrc) {
      return res.status(404).json({ error: "No iframe found on page" });
    }

    // Step 3: Resolve iframe URL
    const iframeUrl = iframeSrc.startsWith("http")
      ? iframeSrc
      : new URL(iframeSrc, targetUrl).toString();

    const iframeRes = await axios.get(iframeUrl, { headers });
    const iframeHtml = iframeRes.data;

    // Step 4: Extract M3U8 link
    const m3u8Match = iframeHtml.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
    if (!m3u8Match) {
      return res.status(404).json({ error: "No m3u8 link found" });
    }

    const m3u8Url = m3u8Match[1];

    // ✅ Return JSON
    return res.json({
      server: "MultiMovies",
      type: "m3u8",
      link: m3u8Url,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Internal error",
      details: err.message,
    });
  }
}

}
