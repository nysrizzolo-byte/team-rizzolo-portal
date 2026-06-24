// Supabase Edge Function: review-du
// Reads an AUS/DU findings PDF with Claude and returns internal guidance for the
// loan team: if Approve/Eligible, the 5 things the borrower must NOT change before
// closing; if Refer/Caution, what's driving it and how to clear each issue.
//
// Auth: called from the DU Review tab (gated to approved employees in the UI) with
// the project publishable key — same pattern as analyze-doc. The Anthropic key lives
// in this function's Secrets.
//
// DEPLOY (Supabase dashboard → Edge Functions → "Deploy a new function"):
//   1. Name it exactly: review-du
//   2. Paste this file as the body.
//   3. It reuses the existing ANTHROPIC_API_KEY secret.
//   4. Deploy, then turn Verify JWT OFF (Function settings), like analyze-doc.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-opus-4-8"; // underwriting reasoning — swap to sonnet/haiku for cost

const SYSTEM = `
You are an expert mortgage underwriting assistant helping a LICENSED loan team
interpret automated underwriting (AUS) findings — Fannie Mae Desktop Underwriter
(DU/DO) or Freddie Mac Loan Product Advisor (LPA). Read the findings document and
produce concise INTERNAL guidance for the loan officer / processor (not advice
delivered directly to the consumer).

First determine the underwriting recommendation as stated in the document
(e.g. "Approve/Eligible", "Accept/Eligible", "Approve/Ineligible", "Refer/Eligible",
"Refer with Caution", "Out of Scope", "Error").

Then:
- If it is an APPROVE/ELIGIBLE (or Accept/Eligible): set mode = "approve_eligible".
  Give the FIVE most important things the borrower must NOT change between now and
  closing/funding that could jeopardize THIS approval — prioritized to what the
  findings actually rely on. For each point: title = the do-not-do item in plain
  client-friendly language; detail = why it matters here and what to tell the client.
  Draw from (pick the 5 most relevant): changing or leaving a job / changing how
  income is paid; large or undocumented deposits or moving money without a paper
  trail; opening new credit or financing big purchases (cars, furniture, appliances);
  taking on new debt, co-signing, or running up card balances (raises DTI); missing
  any payment or letting credit scores drop; spending down the assets/reserves the
  approval depended on.
- If it indicates CAUTION / REFER / non-approval (Refer, Refer with Caution,
  Ineligible, Out of Scope): set mode = "caution". Identify each factor driving the
  caution/refer and give concrete steps to address or clear it. title = the issue;
  detail = how the LO/processor fixes or clears it (docs to collect, conditions to
  satisfy, ratios to improve, letters of explanation needed, etc.).
- Otherwise set mode = "other" and explain briefly in points.

headline = one plain-language sentence on where this file stands.
Be specific to what the findings actually show. Do NOT invent conditions that aren't
supported by the document.
`.trim();

const SCHEMA = {
  type: "object",
  properties: {
    recommendation: { type: "string", description: "The AUS recommendation exactly as stated, e.g. 'Approve/Eligible' or 'Refer with Caution'" },
    mode: { type: "string", enum: ["approve_eligible", "caution", "other"] },
    headline: { type: "string", description: "One plain-language sentence summarizing where the file stands" },
    points: {
      type: "array",
      description: "5 do-not-change items (approve_eligible) or the issues + how to clear them (caution)",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["title", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendation", "mode", "headline", "points"],
  additionalProperties: false,
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { fileBase64, mediaType } = await req.json();
    if (!fileBase64 || !mediaType) return json({ error: "fileBase64 and mediaType are required" }, 400);

    let mediaBlock: unknown;
    if (mediaType === "application/pdf") {
      mediaBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };
    } else if (mediaType.startsWith("image/")) {
      mediaBlock = { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };
    } else {
      return json({ error: `Unsupported media type: ${mediaType}. Use a PDF or image.` }, 415);
    }

    const body = {
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          mediaBlock,
          { type: "text", text: "Review these AUS/DU findings and return the guidance." },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
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
    const data = await res.json();
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "No text block in response", raw: data }, 502);
    return json(JSON.parse(textBlock.text), 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
