export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ error: "No API key set" });

  const models = [
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
    "claude-3-5-sonnet-20241022",
    "claude-3-sonnet-20240229",
    "claude-3-opus-20240229",
    "claude-2.1",
    "claude-2.0",
    "claude-instant-1.2",
  ];

  const results = {};
  for (const model of models) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 5,
          messages: [{ role: "user", content: "Hi" }]
        }),
      });
      const d = await r.json();
      results[model] = d.error ? "❌ " + d.error.type : "✅ WORKS";
    } catch (e) {
      results[model] = "❌ " + e.message;
    }
  }
  return res.status(200).json(results);
}
