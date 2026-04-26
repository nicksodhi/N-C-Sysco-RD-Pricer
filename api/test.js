export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  const key = process.env.ANTHROPIC_API_KEY;
  
  if (!key) {
    return res.status(200).json({ 
      status: "ERROR",
      problem: "ANTHROPIC_API_KEY environment variable is not set in Vercel"
    });
  }

  // Try a minimal API call
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say OK" }]
      }),
    });
    const data = await response.json();
    return res.status(200).json({ 
      status: response.ok ? "SUCCESS" : "API_ERROR",
      key_prefix: key.substring(0, 20) + "...",
      response: data
    });
  } catch (err) {
    return res.status(200).json({ status: "FETCH_ERROR", error: err.message });
  }
}
