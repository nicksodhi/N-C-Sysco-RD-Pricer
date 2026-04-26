export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = { ...req.body, model: "claude-haiku-4-5-20251001" };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    // Post-process: if any result has a low price that matches a known range pattern,
    // ensure we're using case pricing by checking the raw text
    if (data.content) {
      const txt = data.content.find(b => b.type === "text")?.text || "";
      // Fix price ranges in the response - always use higher price
      // Pattern: if raw shows "X-Y" and price is X, change to Y
      const fixedTxt = txt.replace(
        /("price"\s*:\s*)([\d.]+)([^}]*"raw"\s*:\s*"[^"]*\$([\d.]+)-\$([\d.]+)[^"]*")/g,
        (match, priceKey, price, rest, low, high) => {
          const pricedVal = parseFloat(price);
          const lowVal = parseFloat(low);
          const highVal = parseFloat(high);
          // If the price matches the low value, replace with high (case price)
          if (Math.abs(pricedVal - lowVal) < 0.02) {
            return priceKey + highVal + rest;
          }
          return match;
        }
      );
      if (fixedTxt !== txt) {
        data.content = data.content.map(b =>
          b.type === "text" ? { ...b, text: fixedTxt } : b
        );
      }
    }

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
