export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const models = [
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
    "claude-3-5-sonnet-20241022",
    "claude-3-sonnet-20240229",
  ];

  const body = req.body;
  let lastError = null;

  for (const model of models) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...body, model }),
      });
      const data = await response.json();
      if (data.error?.message?.includes("model")) { lastError = data.error.message; continue; }
      return res.status(response.status).json(data);
    } catch (err) { lastError = err.message; continue; }
  }

  return res.status(400).json({ error: lastError || "No working model found" });
}
