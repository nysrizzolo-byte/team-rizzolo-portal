// Supabase Edge Function: assistant-chat (streaming)
// Team Rizzolo's AI mortgage assistant. Multi-turn chat with Claude, STREAMED back
// to the browser (typing effect). Answers underwriting / DU-findings / scenario /
// product questions, can read an attached document, and treats the branch's loaded
// guidelines as the source of truth for their loan products.
//
// Auth: called from the AI Assistant tab with the project publishable key (Verify
// JWT OFF). Anthropic key lives in Secrets.
//
// DEPLOY: Supabase dashboard → Edge Functions → deploy a function named
// "assistant-chat" with this body; reuses ANTHROPIC_API_KEY; Verify JWT OFF.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
// Sonnet 4.6 = fast + strong (great for this). Swap to claude-opus-4-8 for max depth.
const MODEL = "claude-sonnet-4-6";

const PERSONA = `
You are Team Rizzolo's AI mortgage assistant — an internal tool for a New American
Funding branch. You help the team (loan officers, LOAs, processors, juniors) with:
underwriting and AUS/DU findings, loan scenarios, product/guideline questions, and
general mortgage questions. Be accurate, practical, and concise. Use clear markdown
(short paragraphs, bold for key terms, bullet lists) so answers are easy to scan. If
something is outside general knowledge or you're unsure, say so plainly rather than
guessing. This is guidance for licensed professionals — not advice delivered directly
to a consumer.

If the user attaches a document (such as DU/AUS findings), read it and answer about
it. For an Approve/Eligible finding, proactively flag the most important things that
must NOT change before closing. For a Refer / Refer-with-Caution, explain what's
driving it and concrete steps to clear each issue.
`.trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { messages, fileBase64, mediaType, guidelines } = await req.json();
    if (!Array.isArray(messages) || !messages.length) {
      return json({ error: "messages[] is required" }, 400);
    }

    const claudeMessages = messages.map((m: { role: string; content: string }, i: number) => {
      const content: unknown[] = [{ type: "text", text: m.content }];
      const isLast = i === messages.length - 1;
      if (isLast && m.role === "user" && fileBase64 && mediaType) {
        const block = mediaType === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
          : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };
        content.unshift(block);
      }
      return { role: m.role, content };
    });

    const sysText = PERSONA + (guidelines && guidelines.trim()
      ? `\n\nBRANCH PROGRAM GUIDELINES — treat these as the source of truth for our loan products and cite them when relevant:\n${guidelines}`
      : "");

    const body = {
      model: MODEL,
      max_tokens: 1500,
      stream: true,
      system: [{ type: "text", text: sysText, cache_control: { type: "ephemeral" } }],
      messages: claudeMessages,
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json({ error: "Claude API error", status: res.status, detail }, 502);
    }
    // Relay Anthropic's SSE stream straight to the browser.
    return new Response(res.body, {
      headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
