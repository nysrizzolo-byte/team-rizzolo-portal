// Supabase Edge Function: bid-ai
// Conversational assistant that rebuilds a 203(k) contractor bid. Reads an attached original
// bid (PDF/image), takes the processor's instructions, can ask clarifying questions, and
// returns the structured line items the portal fills in. The app does the labor/materials
// split client-side. Approved staff only. Reuses ANTHROPIC_API_KEY.
// Request: { userToken, instructions, footprint?, file?:{dataUrl,name}, current?, history?:[{role,text}] }
// Reply:   { ok, reply, bid|null }
// DEPLOY: new fn "bid-ai", Verify JWT OFF (we verify userToken ourselves).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
async function approvedUser(token: string): Promise<boolean> {
  if (!token || !SB_URL || !SB_ANON) return false;
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const uid = (await u.json())?.id;
    if (!uid) return false;
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=status`, { headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` } });
    if (!p.ok) return false;
    return (await p.json())?.[0]?.status === "approved";
  } catch (_) { return false; }
}

// Trade categories the portal tool understands — AI must pick from these exactly.
const CATS = ["General / Other","Demolition","Framing & Carpentry","Drywall","Painting","Flooring","Tile","Kitchen cabinets & counters","Bath remodel","Plumbing","Electrical","HVAC","Roofing","Windows & Doors","Siding","Masonry & Concrete","Landscaping & Grading","Appliances","Permits & Fees"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 400);
    const body = await req.json().catch(() => ({}));
    if (!(await approvedUser(body.userToken || ""))) return json({ error: "not signed in" }, 401);

    const instructions = String(body.instructions || "").trim();
    const footprint = String(body.footprint || "").trim();
    const file = body.file; // { dataUrl, name }
    if (!instructions && !(file && file.dataUrl)) return json({ error: "Type a message or attach a bid." }, 400);

    // Prior turns (text only — the file + any produced bid are carried forward as context).
    const messages: any[] = [];
    const hist = Array.isArray(body.history) ? body.history.slice(-12) : [];
    for (const h of hist) {
      const role = h?.role === "assistant" ? "assistant" : "user";
      const text = String(h?.text || "").slice(0, 4000);
      if (text) messages.push({ role, content: text });
    }

    // Current user turn — may carry the attached original bid.
    const content: any[] = [];
    if (file && typeof file.dataUrl === "string") {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(file.dataUrl);
      if (m) {
        const mt = m[1], data = m[2];
        if (mt === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
        else if (mt.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: mt, data } });
      }
    }
    const curr = body.current ? JSON.stringify(body.current).slice(0, 6000) : "";
    content.push({ type: "text", text:
      `${file && file.dataUrl ? "The attached file is the original contractor bid.\n" : ""}` +
      `${instructions || "(rebuild the attached bid in our format)"}` +
      `${footprint ? `\n\nProperty footprint / measurements: ${footprint}` : ""}` +
      `${curr ? `\n\nCurrent working bid (JSON) to adjust instead of starting over:\n${curr}` : ""}` });
    messages.push({ role: "user", content });

    const system = `You are a bid assistant for an FHA 203(k) loan processor. You help turn a contractor's bid into our itemized format, and you can hold a short back-and-forth to get it right.

ALWAYS output ONLY valid minified JSON — no prose, no markdown, no code fences — with EXACTLY this shape:
{"reply":"<your message to the processor>","bid":null}
or, when you have enough to build or update the bid:
{"reply":"<short message describing what you did>","bid":{"contractor":{"name":"","address":"","phone":"","email":"","license":""},"property":"","owner":"","scope":"","footprint":"","lines":[{"desc":"","cat":"","cost":0}],"note":""}}

Rules:
- "reply" is ALWAYS present — a short, plain message to the processor. If something important is unclear or missing (e.g. no target total and the amounts are ambiguous, conflicting instructions, missing measurements that materially change an estimate), ASK your question(s) in "reply" and set "bid" to null. Ask only genuinely pertinent questions; don't interrogate.
- Include "bid" (the full object) once you can build or update it; otherwise null.
- "cat" MUST be exactly one of: ${CATS.join(" | ")}. Choose the closest trade per repair.
- "cost" is a whole-dollar number = the all-in cost for that line. Do NOT split labor vs materials; our app does that.
- If a TARGET TOTAL is given (e.g. "same work for $120,000"), adjust line costs to sum to it while keeping the same scope — spread proportionally unless told which items to change. Otherwise keep original amounts.
- Use the footprint / square footage to size and sanity-check estimates (roofing by roof area, flooring/tile by floor area, paint by wall area, HVAC by conditioned area) and reflect quantities in each line's description (e.g. "Roof tear-off, ~1,800 sq ft"). Mention implied $/sq ft in "note" when useful.
- Keep the original scope unless told to change it; summarize it plainly in "scope". Carry over contractor/property/homeowner/footprint details from the original; "" if unknown. Echo the footprint you used in "footprint". Never invent a logo.
- "note": one short sentence on what changed (e.g. "Scaled 6 lines from $240,000 to $120,000, same scope.").`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, system, messages }),
    });
    const j = await res.json();
    if (!res.ok) return json({ error: "AI error: " + JSON.stringify(j).slice(0, 300) }, 500);
    let txt = (j?.content?.[0]?.text || "").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    let out: any;
    try { out = JSON.parse(txt); } catch (_) { return json({ ok: true, reply: txt || "I couldn't format that — try rephrasing.", bid: null }); }

    let bid = out?.bid ?? null;
    if (bid && Array.isArray(bid.lines)) {
      bid.lines = bid.lines.filter((l: any) => l && (l.desc || l.cost)).map((l: any) => ({
        desc: String(l.desc || "").slice(0, 200),
        cat: CATS.includes(l.cat) ? l.cat : "General / Other",
        cost: Math.max(0, Math.round(Number(l.cost) || 0)),
      }));
    } else { bid = null; }
    const reply = String(out?.reply || (bid ? "Here's the updated bid." : "Could you tell me a bit more?")).slice(0, 1500);
    return json({ ok: true, reply, bid });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
