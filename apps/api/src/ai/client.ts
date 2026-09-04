import Groq from "groq-sdk";

let _client: Groq | null = null;

/**
 * Lazily-constructed singleton so importing this module (e.g. in tests that
 * inject a fake LLMClient into the agents) never requires GROQ_API_KEY.
 */
export function getGroqClient(): Groq {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Required to call the Investigator/Decision agents."
      );
    }
    _client = new Groq({ apiKey });
  }
  return _client;
}

// gpt-oss-120b: OpenAI's open-weight (Apache 2.0) model, served by Groq.
// Chosen over Groq's Llama/Qwen options because it's the largest model in
// their current lineup with both "tools" and "structured_outputs" support,
// which callStructured's forced function-calling relies on.
export const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
