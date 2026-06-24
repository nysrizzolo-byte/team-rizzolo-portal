// Supabase Edge Function: split-doc
// Reads a COMBINED PDF (several documents stacked into one file) with Claude and
// returns each distinct document's page range + identity, so the Doc Renamer can
// split it into separate, individually-named PDFs.
//
// Auth: called from the Doc Renamer with the publishable key (Verify JWT OFF), same
// as analyze-doc. Anthropic key in Secrets.
//
// DEPLOY: Supabase dashboard → Edge Functions → deploy a function named "split-doc"
// with this body; reuses ANTHROPIC_API_KEY; Verify JWT OFF.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-opus-4-8"; // segmentation accuracy matters

const DOC_TYPES = [
  "W-2", "1099", "Pay Stub", "Bank Statement", "Tax Return", "Driver's License",
  "Photo ID", "Award Letter", "Social Security", "Pension Statement", "Mortgage Statement",
  "Homeowners Insurance", "Purchase Contract", "Gift Letter", "VOE", "LOE",
  "Appraisal", "Credit Report", "AUS Findings", "Closing Disclosure",
  "Business Tax Return", "Profit & Loss", "K-1",
  "Retirement Statement", "Investment Statement", "Gift Donor Proof", "Earnest Money", "VOD",
  "Passport", "Green Card", "Visa", "SSN Card", "VA COE", "DD-214",
  "Flood Insurance", "Property Tax Bill", "HOA Statement", "Title Commitment", "Loan Estimate",
  "Divorce Decree", "Child Support", "Other",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { fileBase64, pageCount } = await req.json();
    if (!fileBase64) return json({ error: "fileBase64 is required" }, 400);
    const pages = Number(pageCount) || 0;

    const system = `
You are segmenting a COMBINED PDF that may contain several separate documents stacked
together (for example, a borrower scanned a W-2, two pay stubs, and bank statements
into one file). The PDF has ${pages} pages, numbered 1..${pages}.

Identify each DISTINCT document and the CONTIGUOUS page range it occupies. Rules:
- Segments must be in page order, non-overlapping, and together cover every page 1..${pages}.
- A single document can span multiple pages (e.g. a 3-page bank statement) — keep its
  pages together as ONE segment.
- If the file is actually just one document, return ONE segment covering 1..${pages}.

For each segment also extract:
- full_name: the person the document is about, "First Last".
- doc_type: the single best match from this list: ${DOC_TYPES.join(", ")}.
- year: 4-digit year the document pertains to, or empty string.
- pay_date: Pay Stub only — the pay-period END/through date as YYYY-MM-DD; empty otherwise.
- start_page / end_page: 1-indexed, inclusive.
- confidence: high | medium | low.
`.trim();

    const SCHEMA = {
      type: "object",
      properties: {
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              full_name: { type: "string" },
              doc_type: { type: "string" },
              year: { type: "string" },
              pay_date: { type: "string" },
              start_page: { type: "integer" },
              end_page: { type: "integer" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["full_name", "doc_type", "year", "pay_date", "start_page", "end_page", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["segments"],
      additionalProperties: false,
    };

    const body = {
      model: MODEL,
      max_tokens: 3000,
      system,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } },
          { type: "text", text: "Segment this combined PDF into its separate documents." },
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
