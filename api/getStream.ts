import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";
import * as cheerio from "cheerio";
import FormData from "form-data";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing ?url parameter" });
  }
  if (Array.isArray(url)) url = url[0];

  const targetUrl = decodeURIComponent(url.toString().trim());
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
    // Step 1: fetch page
    const resPage = await axios.get(targetUrl, { headers });
    const $ = cheerio.load(resPage.data);

    const postId = $("#player-option-1").attr("data-post");
    const nume = $("#player-option-1").attr("data-nume");
    const typeValue = $("#player-option-1").attr("data-type");
    const baseUrl = targetUrl.split("/").slice(0, 3).join("/");

    if (!postId) {
      return res.status(404).json({ error: "Player element not found" });
    }

    // Step 2: call ajax
    const formData = new FormData();
    formData.append("action", "doo_player_ajax");
    formData.append("post", postId);
    formData.append("nume", nume || "");
    formData.append("type", typeValue || "");

    const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
      headers,
      body: formData as any,
      method: "POST",
    });
    const playerData = await playerRes.json();

    let iframeUrl =
      playerData?.embed_url?.match(/<iframe[^>]+src="([^"]+)"/i)?.[1] ||
      playerData?.embed_url;

    if (!iframeUrl) {
      return res.status(404).json({ error: "No iframe URL found" });
    }

    // Step 3: fetch iframe page
    const iframeRes = await axios.get(iframeUrl, { headers: { ...headers, Referer: targetUrl } });
    const iframeHtml = iframeRes.data;

    // Step 4: decode eval-packed JS
    const functionRegex = /eval\(function\((.*?)\)\{.*?return p\}.*?\('(.*?)'\.split/;
    const match = functionRegex.exec(iframeHtml);
    let decoded = "";
    if (match) {
      const encodedString = match[2];
      decoded = encodedString.split("',36,")[0].trim();
      let a = 36;
      let c = encodedString.split("',36,")[1].slice(2).split("|").length;
      let k = encodedString.split("',36,")[1].slice(2).split("|");
      while (c--) {
        if (k[c]) {
          const regex = new RegExp("\\b" + c.toString(a) + "\\b", "g");
          decoded = decoded.replace(regex, k[c]);
        }
      }
    }

    // Step 5: extract m3u8
    const streamUrl = decoded?.match(/https?:\/\/[^"']+?\.m3u8[^"']*/)?.[0];
    if (!streamUrl) {
      return res.status(404).json({ error: "No m3u8 link found" });
    }

    // Step 6: optional subtitles
    const subtitles: { language: string; uri: string; type: string; title: string }[] = [];
    const subtitleMatch = decoded?.match(/https:\/\/[^\s"']+\.vtt/g);
    if (subtitleMatch?.length) {
      subtitleMatch.forEach((sub: string) => {
        const lang = sub.match(/_([a-zA-Z]{2,3})\.vtt$/)?.[1] || "und";
        subtitles.push({
          language: lang,
          uri: sub,
          type: "text/vtt",
          title: lang,
        });
      });
    }

    // ✅ Response
    return res.json({
      server: "MultiMovies",
      type: "m3u8",
      link: streamUrl.replace(/&i=\d+,'\.4&/, "&i=0.4&"),
      subtitles,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Internal error", details: err.message || err });
  }
}
