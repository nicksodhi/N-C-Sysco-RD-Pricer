export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ error: "No API key set" });

  // First get the list of available models from Anthropic
  try {
    const modelsResp = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    const modelsData = await modelsResp.json();
    
    if (modelsData.data) {
      // Try the first available model with a real call
      const firstModel = modelsData.data[0]?.id;
      let testResult = null;
      if (firstModel) {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: firstModel,
            max_tokens: 5,
            messages: [{ role: "user", content: "Hi" }]
          }),
        });
        testResult = await r.json();
      }
      return res.status(200).json({
        available_models: modelsData.data.map(m => m.id),
        test_model: firstModel,
        test_result: testResult?.content ? "✅ WORKS" : testResult?.error?.message
      });
    }
    return res.status(200).json({ models_response: modelsData });
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
