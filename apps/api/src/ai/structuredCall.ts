import type { z } from "zod";
import type Groq from "groq-sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getGroqClient, DEFAULT_MODEL } from "./client.js";

export interface StructuredCallParams<T extends z.ZodTypeAny> {
  system: string;
  prompt: string;
  schema: T;
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
}

/**
 * Forces the model to respond via a single tool call shaped like `schema`,
 * then validates the tool arguments with Zod. This is the ONLY way agents in
 * this codebase get output from the LLM — callers receive a plain validated
 * object, never raw model text, so a malformed or hallucinated response
 * cannot silently flow downstream (see policyEngine.ts, which is the next
 * hard gate after this).
 */
export async function callStructured<T extends z.ZodTypeAny>(
  params: StructuredCallParams<T>
): Promise<z.infer<T>> {
  const client = getGroqClient();
  const jsonSchema = zodToJsonSchema(params.schema, "output");
  const parameters = (jsonSchema.definitions?.output ?? jsonSchema) as Record<string, unknown>;

  const tool: Groq.Chat.Completions.ChatCompletionTool = {
    type: "function",
    function: {
      name: params.toolName,
      description: params.toolDescription,
      parameters,
    },
  };

  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: params.system },
    { role: "user", content: params.prompt },
  ];

  // Up to two attempts: if the first response fails to parse or fails Zod
  // validation, we hand the model the exact error and ask it to correct
  // itself once. Open-weight models are more prone to slightly malformed
  // JSON than Claude was, so a parse failure is treated as retryable too.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? 1024,
      messages,
      tools: [tool],
      tool_choice: { type: "function", function: { name: params.toolName } },
    });

    const message = response.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error(`LLM did not return a ${params.toolName} tool call`);
    }

    const validation = parseAndValidate(toolCall.function.arguments, params.schema);
    if (validation.success) {
      return validation.data;
    }

    if (attempt === 0) {
      messages.push(
        { role: "assistant", content: message.content, tool_calls: message.tool_calls },
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Invalid output: ${validation.error}. Call ${params.toolName} again with corrected values that satisfy the schema.`,
        }
      );
      continue;
    }

    throw new Error(`LLM output failed schema validation twice: ${validation.error}`);
  }

  // Unreachable, but keeps TypeScript's control-flow analysis happy.
  throw new Error("callStructured: exhausted retries");
}

function parseAndValidate<T extends z.ZodTypeAny>(
  rawArguments: string,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(rawArguments);
  } catch {
    return { success: false, error: "arguments were not valid JSON" };
  }

  const parsed = schema.safeParse(rawArgs);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return { success: false, error: parsed.error.message };
}
