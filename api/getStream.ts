import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

interface Stream {
  server: string;
  link: string;
  type: string;
  subtitles: Subtitle[];
  quality?: string;
}

interface Subtitle {
  language: string;
  uri: string;
  type: string;
  title: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid url parameter' });
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

  } catch (error: any) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

async function getStreamData(url: string): Promise<Stream[]> {
  const headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "upgrade-insecure-requests": "1",
    "Referer": "https://multimovies.mobi/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  };

  console.log('Fetching URL:', url);
  
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: (status) => status < 500
  });
  
  const html = response.data;
  const $ = cheerio.load(html);
  const streamLinks: Stream[] = [];

  // Extract player data
  const postId = $("#player-option-1").attr("data-post");
  const nume = $("#player-option-1").attr("data-nume");
  const typeValue = $("#player-option-1").attr("data-type");

  console.log('Player data:', { postId, nume, typeValue });

  if (!postId) {
    throw new Error('Could not extract player data from the page');
  }

  const baseUrl = new URL(url).origin;
  console.log('Base URL:', baseUrl);

  // Prepare form data for AJAX request
  const formData = new URLSearchParams();
  formData.append("action", "doo_player_ajax");
  formData.append("post", postId);
  formData.append("nume", nume || "");
  formData.append("type", typeValue || "");

  console.log('Making AJAX request to:', `${baseUrl}/wp-admin/admin-ajax.php`);

  // Make the AJAX request
  const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
    headers: {
      ...headers,
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      'referer': url,
    },
    body: formData.toString(),
    method: "POST",
  });

  // Check if response is HTML instead of JSON
  const contentType = playerRes.headers.get('content-type');
  const responseText = await playerRes.text();

  console.log('Response Content-Type:', contentType);
  console.log('Response status:', playerRes.status);

  if (!contentType || !contentType.includes('application/json')) {
    console.log('Non-JSON response received:', responseText.substring(0, 500));
    throw new Error('Server returned HTML instead of JSON. Possible block or redirect.');
  }

  let playerData: any;
  try {
    playerData = JSON.parse(responseText);
  } catch (parseError) {
    console.log('Failed to parse JSON:', responseText.substring(0, 500));
    throw new Error('Invalid JSON response from server');
  }

  console.log('Player data received:', Object.keys(playerData));

  let iframeUrl = playerData?.embed_url;
  
  // Extract iframe URL if it's embedded in HTML
  if (iframeUrl && iframeUrl.includes('<iframe')) {
    const iframeMatch = iframeUrl.match(/<iframe[^>]+src="([^"]+)"[^>]*>/i);
    iframeUrl = iframeMatch ? iframeMatch[1] : iframeUrl;
  }

  console.log('Iframe URL:', iframeUrl);

  if (!iframeUrl) {
    throw new Error('No iframe URL found in player data');
  }

  // Handle external players
  if (!iframeUrl.includes("multimovies")) {
    console.log('External player detected, processing...');
    
    try {
      let playerBaseUrl = new URL(iframeUrl).origin;
      
      // Try to get the final URL after redirects
      try {
        const redirectCheck = await axios.get(iframeUrl, {
          headers,
          maxRedirects: 5,
          timeout: 10000,
          validateStatus: null
        });
        
        playerBaseUrl = new URL(redirectCheck.request.res.responseUrl).origin;
      } catch (redirectError) {
        console.log('Redirect check failed, using original URL');
      }

      const playerId = iframeUrl.split('/').pop();
      console.log('Player ID:', playerId);

      const embedFormData = new URLSearchParams();
      embedFormData.append("sid", playerId || "");

      console.log('Making embed request to:', `${playerBaseUrl}/embedhelper.php`);

      const embedRes = await fetch(`${playerBaseUrl}/embedhelper.php`, {
        headers: {
          ...headers,
          'content-type': 'application/x-www-form-urlencoded',
          'referer': iframeUrl,
        },
        body: embedFormData.toString(),
        method: "POST",
      });

      const embedText = await embedRes.text();
      let embedData: any;

      // Check if response is JSON
      if (embedText.trim().startsWith('{')) {
        try {
          embedData = JSON.parse(embedText);
        } catch (e) {
          console.log('Failed to parse embed data as JSON');
          // Try to extract JSON from possible JavaScript response
          const jsonMatch = embedText.match(/{[^]*?}/);
          if (jsonMatch) {
            embedData = JSON.parse(jsonMatch[0]);
          }
        }
      }

      if (embedData) {
        console.log('Embed data received:', Object.keys(embedData));
        
        let siteUrl = embedData?.siteUrls?.smwh;
        let siteId = embedData?.mresult?.smwh;

        // Try to decode base64 mresult
        if (!siteId && embedData?.mresult) {
          try {
            const decodedResult = JSON.parse(Buffer.from(embedData.mresult, 'base64').toString());
            siteId = decodedResult?.smwh;
          } catch (e) {
            console.log('Base64 decoding failed');
          }
        }

        if (siteUrl && siteId) {
          iframeUrl = siteUrl + siteId;
          console.log('New iframe URL:', iframeUrl);
        }
      }
    } catch (externalError) {
      console.log('External player processing failed, continuing with original iframe URL');
    }
  }

  // Fetch the iframe content
  console.log('Fetching iframe content from:', iframeUrl);
  
  const iframeRes = await axios.get(iframeUrl, {
    headers: {
      ...headers,
      Referer: url,
    },
    timeout: 10000,
  });
  
  const iframeData = iframeRes.data;

  // Extract and decode the obfuscated JavaScript
  const functionRegex = /eval\(function\([^)]+\)\{[^}]+\return p\}[^)]+\('([^']+)'/;
  const match = functionRegex.exec(iframeData);
  
  let decodedString = "";
  
  if (match) {
    const encodedString = match[1];
    console.log('Found encoded string, length:', encodedString.length);
    
    try {
      decodedString = decodeObfuscatedString(encodedString);
      console.log('Decoding successful');
    } catch (decodeError) {
      console.log('Decoding failed:', decodeError.message);
    }
  } else {
    // Try alternative pattern
    const altRegex = /(?:eval|function).*?\(.*?['"]([a-zA-Z0-9+/=]+)['"]/;
    const altMatch = altRegex.exec(iframeData);
    if (altMatch) {
      console.log('Found alternative pattern');
      decodedString = decodeObfuscatedString(altMatch[1]);
    }
  }

  // Extract M3U8 URL
  const streamUrl = decodedString?.match(/https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*/)?.[0];
  
  // Extract subtitles
  const subtitles: Subtitle[] = [];
  const subtitleMatch = decodedString?.match(/https?:\/\/[^"'\s]+?\.vtt/g);
  
  if (subtitleMatch?.length) {
    subtitleMatch.forEach((sub) => {
      const langMatch = sub.match(/_([a-zA-Z]{2,4})\.vtt$/);
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

  console.log('Found stream URL:', streamUrl);
  console.log('Found subtitles:', subtitles.length);

  if (streamUrl) {
    // Clean the URL
    const cleanedUrl = streamUrl.replace(/&i=\d+,'\.4&/, "&i=0.4&");
    
    streamLinks.push({
      server: "MultiMovies",
      link: cleanedUrl,
      type: "m3u8",
      subtitles: subtitles,
      quality: "auto"
    });
  }

  return streamLinks;
}

function decodeObfuscatedString(encodedString: string): string {
  try {
    const parts = encodedString.split("',");
    if (parts.length < 2) return encodedString;

    let p = parts[0].replace(/'/g, '');
    const secondPart = parts[1];
    
    const baseMatch = secondPart.match(/(\d+),(\d+)/);
    if (!baseMatch) return p;

    const base = parseInt(baseMatch[1]);
    const count = parseInt(baseMatch[2]);
    
    const k = secondPart.split('|').slice(1);
    
    for (let i = 0; i < count; i++) {
      if (k[i]) {
        const regex = new RegExp(`\\b${i.toString(base)}\\b`, 'g');
        p = p.replace(regex, k[i]);
      }
    }
    
    return p;
  } catch (error) {
    console.log('Decoding error:', error);
    return encodedString;
  }
      }    });

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
    "Referer": "https://multimovies.mobi/",
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
