import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const streamData = await getStreamData(url);
    
    if (streamData.length === 0) {
      return res.status(404).json({ error: 'No streams found' });
    }

    return res.status(200).json({
      success: true,
      data: streamData,
      source: 'multimovies'
    });

  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

async function getStreamData(url) {
  const headers = {
    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Referer": "https://multimovies.online/",
    "Sec-Fetch-User": "?1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  };

  const res = await axios.get(url, { headers });
  const html = res.data;
  const $ = cheerio.load(html);
  const streamLinks = [];

  const postId = $("#player-option-1").attr("data-post");
  const nume = $("#player-option-1").attr("data-nume");
  const typeValue = $("#player-option-1").attr("data-type");

  const baseUrl = url.split("/").slice(0, 3).join("/");

  const formData = new URLSearchParams();
  formData.append("action", "doo_player_ajax");
  formData.append("post", postId || "");
  formData.append("nume", nume || "");
  formData.append("type", typeValue || "");

  const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
    headers: headers,
    body: formData,
    method: "POST",
  });
  
  const playerData = await playerRes.json();
  
  let ifameUrl =
    playerData?.embed_url?.match(/<iframe[^>]+src="([^"]+)"[^>]*>/i)?.[1] ||
    playerData?.embed_url;

  if (!ifameUrl.includes("multimovies")) {
    let playerBaseUrl = ifameUrl.split("/").slice(0, 3).join("/");
    
    try {
      const newPlayerBaseUrl = await axios.head(playerBaseUrl, { 
        headers,
        maxRedirects: 5 
      });
      
      if (newPlayerBaseUrl?.request?.responseURL) {
        playerBaseUrl = newPlayerBaseUrl.request.responseURL
          .split("/")
          .slice(0, 3)
          .join("/");
      }
    } catch (error) {
      console.log('Head request failed, trying with redirect handling');
      
      try {
        const redirectResponse = await axios.get(playerBaseUrl, {
          headers,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
        });
        
        if (redirectResponse.headers?.location) {
          playerBaseUrl = redirectResponse.headers.location
            .split("/")
            .slice(0, 3)
            .join("/");
        }
      } catch (redirectError) {
        console.log('Redirect handling failed, using original URL');
      }
    }

    const playerId = ifameUrl.split("/").pop();
    const NewformData = new URLSearchParams();
    NewformData.append("sid", playerId);
    
    const embedRes = await fetch(`${playerBaseUrl}/embedhelper.php`, {
      headers: headers,
      body: NewformData,
      method: "POST",
    });
    
    const embedData = await embedRes.json();
    const siteUrl = embedData?.siteUrls?.smwh;
    const siteId = JSON.parse(Buffer.from(embedData?.mresult, 'base64').toString())?.smwh || embedData?.mresult?.smwh;
    const newIframeUrl = siteUrl + siteId;
    
    if (newIframeUrl) {
      ifameUrl = newIframeUrl;
    }
  }

  const iframeRes = await axios.get(ifameUrl, {
    headers: {
      ...headers,
      Referer: url,
    },
  });
  
  const iframeData = iframeRes.data;

  // Decode the obfuscated JavaScript
  const functionRegex = /eval\(function\((.*?)\)\{.*?return p\}.*?\('(.*?)'\.split/;
  const match = functionRegex.exec(iframeData);
  let p = "";
  
  if (match) {
    const encodedString = match[2];
    p = encodedString.split("',36,")?.[0].trim();
    const a = 36;
    const k = encodedString.split("',36,")[1].slice(2).split("|");
    const c = k.length;

    for (let i = 0; i < c; i++) {
      if (k[i]) {
        const regex = new RegExp("\\b" + i.toString(a) + "\\b", "g");
        p = p.replace(regex, k[i]);
      }
    }
  }

  const streamUrl = p?.match(/https?:\/\/[^"]+?\.m3u8[^"]*/)?.[0];
  const subtitles = [];
  const subtitleMatch = p?.match(/https:\/\/[^\s"]+\.vtt/g);

  if (subtitleMatch?.length) {
    subtitleMatch.forEach((sub) => {
      const langMatch = sub.match(/_([a-zA-Z]{3})\.vtt$/);
      if (langMatch) {
        const lang = langMatch[1];
        subtitles.push({
          language: lang,
          uri: sub,
          type: "text/vtt",
          title: lang,
        });
      }
    });
  }

  if (streamUrl) {
    const cleanedUrl = streamUrl.replace(/&i=\d+,'\.4&/, "&i=0.4&");
    
    streamLinks.push({
      server: "Multi",
      link: cleanedUrl,
      type: "m3u8",
      subtitles: subtitles,
    });
  }

  return streamLinks;
}
