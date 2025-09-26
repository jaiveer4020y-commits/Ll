import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";
import * as cheerio from "cheerio";
import FormData from "form-data";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing ?url parameter" });
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
    const resPage = await axios.get(url, { headers });
    const $ = cheerio.load(resPage.data);

    const postId = $("#player-option-1").attr("data-post");
    const nume = $("#player-option-1").attr("data-nume");
    const typeValue = $("#player-option-1").attr("data-type");
    const baseUrl = url.split("/").slice(0, 3).join("/");

    const formData = new FormData();
    formData.append("action", "doo_player_ajax");
    formData.append("post", postId || "");
    formData.append("nume", nume || "");
    formData.append("type", typeValue || "");

    // Step 2: Ajax request
    const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
      headers,
      body: formData as any,
      method: "POST",
    });

    const playerData = await playerRes.json();
    let iframeUrl =
      playerData?.embed_url?.match(/<iframe[^>]+src="([^"]+)"/i)?.[1] ||
      playerData?.embed_url;

    // Step 3: Open iframe page
    const iframeRes = await axios.get(iframeUrl, {
      headers: { ...headers, Referer: url },
    });
    const iframeData = iframeRes.data;

    // Step 4: Decode packed eval
    const functionRegex =
      /eval\(function\((.*?)\)\{.*?return p\}.*?\('(.*?)'\.split/;
    const match = functionRegex.exec(iframeData);
    let decoded = "";
    if (match) {
      const encodedString = match[2];
      decoded = encodedString.split("',36,")[0].trim();
      let a = 36;
      let c = encodedString.split("',36,")[1].slice(2).split("|").length;
      let k = encodedString.split("',36,")[1].slice(2).split("|");
      while (c--) {
        if (k[c]) {
          var regex = new RegExp("\\b" + c.toString(a) + "\\b", "g");
          decoded = decoded.replace(regex, k[c]);
        }
      }
    }

    const streamUrl = decoded?.match(/https?:\/\/[^"]+?\.m3u8[^"]*/)?.[0];

    if (!streamUrl) {
      return res.status(404).json({ error: "No m3u8 found" });
    }

    return res.json({
      server: "Multi",
      type: "m3u8",
      link: streamUrl.replace(/&i=\d+,'\.4&/, "&i=0.4&"),
    });
  } catch (err: any) {
    console.error(err.message || err);
    return res
      .status(500)
      .json({ error: "Internal error", details: err.message || err });
  }
}
