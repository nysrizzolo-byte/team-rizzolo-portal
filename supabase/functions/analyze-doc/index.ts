// Supabase Edge Function: analyze-doc
// Reads a dropped document (PDF or image) with Claude's vision model and
// extracts { full_name, doc_type, year } so the Doc Renamer can auto-fill
// "Full Name - Doc Type - Year". The Anthropic API key lives in this function's
// Secrets (server-side) and is never exposed to the browser.
//
// DEPLOY (Supabase dashboard → Edge Functions → "Deploy a new function"):
//   1. Name it exactly: analyze-doc
//   2. Paste this file as the function body.
//   3. Set a secret named ANTHROPIC_API_KEY (Edge Functions → Manage secrets).
//   4. Deploy. The renamer calls it with the project anon key.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// Default to the most capable model. To cut cost on high volume, you can switch
// this to "claude-haiku-4-5" or "claude-sonnet-4-6" — that's your call.
const MODEL = "claude-opus-4-8";

// The team's canonical doc-type labels. Claude is told to pick from these so the
// output always matches the renamer's dropdown.
const DOC_TYPES = [
  "W-2", "1099", "Pay Stub", "Bank Statement", "Tax Return", "Driver's License",
  "Photo ID", "Award Letter", "Social Security", "Pension Statement", "Mortgage Statement",
  "Homeowners Insurance", "Purchase Contract", "Gift Letter", "VOE", "LOE",
  "Appraisal", "Credit Report", "AUS Findings", "Closing Disclosure",
  // Self-employed
  "Business Tax Return", "Profit & Loss", "K-1",
  // Assets
  "Retirement Statement", "Investment Statement", "Gift Donor Proof", "Earnest Money", "VOD",
  // Identity & VA
  "Passport", "Green Card", "Visa", "SSN Card", "VA COE", "DD-214",
  // Property & legal
  "Flood Insurance", "Property Tax Bill", "HOA Statement", "Title Commitment", "Loan Estimate",
  "Divorce Decree", "Child Support",
  "Other",
];

// "House rules" — Sal's conventions. Edit freely; every future doc follows them.
const HOUSE_RULES = `
- full_name: the borrower/person the document is ABOUT (e.g. the employee on a W-2,
  the account holder on a bank statement). Use the name exactly as printed, in
  "First Last" order. If two names appear (joint account), use the primary/first one.
- doc_type: choose the single best match from the allowed list. Map synonyms:
  "Wage and Tax Statement" -> "W-2"; "Form 1040" / tax transcript -> "Tax Return";
  "earnings statement" -> "Pay Stub"; "account statement" from a bank -> "Bank Statement";
  Form 1120/1120S/1065 -> "Business Tax Return"; Schedule K-1 -> "K-1";
  401(k)/IRA/retirement statement -> "Retirement Statement"; taxable brokerage statement -> "Investment Statement";
  income statement / "profit and loss" -> "Profit & Loss"; Certificate of Eligibility -> "VA COE";
  permanent resident card -> "Green Card".
  If nothing fits, use "Other".
- year: the year the document pertains to (tax year on a W-2/return; statement
  period year on a bank/mortgage statement). 4 digits. If a range, use the latest year.
- pay_date: ONLY for doc_type "Pay Stub". The pay/check date if shown; if there is
  no pay date, use the pay-period END / "through" date. Format strictly as YYYY-MM-DD.
  Leave it an empty string for every other doc_type.
- If a field genuinely can't be determined, return an empty string for it and set
  confidence to "low". Never guess a name you can't read.
`.trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCHEMA = {
  type: "object",
  properties: {
    full_name: { type: "string", description: "Person's full name, 'First Last', exactly as printed" },
    doc_type: { type: "string", description: `One of: ${DOC_TYPES.join(", ")}` },
    year: { type: "string", description: "4-digit year the document pertains to, or empty string" },
    pay_date: { type: "string", description: "Pay Stub only: pay date or pay-period through/end date as YYYY-MM-DD; empty for other doc types" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["full_name", "doc_type", "year", "pay_date", "confidence"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { fileBase64, mediaType, learnedExamples } = await req.json();
    if (!fileBase64 || !mediaType) {
      return json({ error: "fileBase64 and mediaType are required" }, 400);
    }

    // Build the document/image content block.
    let mediaBlock: unknown;
    if (mediaType === "application/pdf") {
      mediaBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } };
    } else if (mediaType.startsWith("image/")) {
      mediaBlock = { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };
    } else {
      return json({ error: `Unsupported media type: ${mediaType}. Use PDF or an image.` }, 415);
    }

    // "Learned corrections" — the train-it-along-the-way loop. Each is a prior
    // mistake the team fixed; we feed them back so Claude improves on your docs.
    // (Frontend can pull these from a Supabase table and pass them in here.)
    const examplesText = Array.isArray(learnedExamples) && learnedExamples.length
      ? "\n\nLearned corrections from this team (match these patterns):\n" +
        learnedExamples.map((e: { note: string }) => `- ${e.note}`).join("\n")
      : "";

    const system =
      `You label mortgage borrower documents. Allowed doc_type values: ${DOC_TYPES.join(", ")}.\n\n` +
      `House rules:\n${HOUSE_RULES}${examplesText}`;

    const body = {
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{
        role: "user",
        content: [
          mediaBlock,
          { type: "text", text: "Identify this document. Return full_name, doc_type, year, and confidence." },
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
    // With output_config.format, the first text block is valid JSON.
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "No text block in response", raw: data }, 502);

    const parsed = JSON.parse(textBlock.text);
    return json(parsed, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
