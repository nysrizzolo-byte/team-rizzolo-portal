// Supabase Edge Function: k203-bot
// The "203K Coach" — a practice/training bot for real-estate agents on FHA 203(k)
// renovation loans. Two modes × two personas:
//   mode "coach"   → the bot is the 203k EXPERT: gives the agent ready-to-say language.
//   mode "roleplay"→ the bot PLAYS the other side and the agent practices on it.
//   persona "client" → a home buyer;  persona "agent" → a resistant LISTING agent.
// Non-streaming: returns { reply }. Auth: Verify JWT OFF + publishable key (like trainer-bot).
// DEPLOY: new fn "k203-bot", Verify JWT OFF; reuses ANTHROPIC_API_KEY.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
async function callClaude(system: string, messages: unknown[], maxTokens = 600) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error("Claude API " + res.status + ": " + (await res.text()));
  const data = await res.json();
  return (data?.content?.[0]?.text ?? "").trim();
}

// ── The 203k knowledge base (the bot's brain) ──
const KB = `
FHA 203(k) RENOVATION LOAN — WHAT YOU KNOW (Team Rizzolo does these all the time):
- One loan, one closing: finances the purchase AND the renovation together, priced off the home's AFTER-renovation value (not a separate construction loan).
- As little as 3.5% down (FHA), calculated on the whole project — so the buyer doesn't need a second pile of cash to renovate after closing.
- Two versions: LIMITED 203(k) up to $75,000 in repairs (cosmetic/non-structural, less paperwork) and STANDARD 203(k) for structural/larger jobs (requires a HUD consultant).
- The RENOVATION happens AFTER closing — it does NOT delay the closing itself.
- Buyer takes the home AS-IS: repairs are financed, so they are NOT asking the seller for repair credits or to fix anything first.
- Covers real work: kitchens, baths, roofs, HVAC, oil-to-gas conversion, septic/cesspool, electrical, windows, structural, mold/lead. Not pure luxury (a brand-new pool).
- FHA-friendly credit; 1-4 units; owner-occupant primary residence (great for house-hacking a 2-4 family).
- The appraisal is "subject-to" the finished plans and bids — based on after-repair value, so adding value is the point.
- Alternative: Fannie Mae HomeStyle (conventional reno — allows investment/luxury/higher limits). Team Rizzolo picks the right tool.

THE LEVERAGE FRAMING (a favorite): put 3.5% down and build ~10% equity through the renovation and that is roughly a 286% return on the cash you put in — you nearly triple your money on paper, day one. (Illustrative — ignores closing costs and assumes you buy right and the reno actually adds value.)

WHY IT MATTERS (practical uses): control a renovated asset for 3.5% down; solve the "can't afford the down payment AND renovation cash" problem; win dated/distressed listings nobody else can finance; an owner-occupant can beat lowball cash investors on a rough house; buy up into a better block by taking one that needs work; house-hack a 2-4 family.

LONG ISLAND ANGLES: tons of older LI housing stock with dated kitchens/baths, oil heat, old roofs — perfect candidates; oil-to-gas conversions and Suffolk County cesspool→septic/I-A systems are financeable; Nassau & Suffolk sit near the top FHA loan limits so it works on higher-priced homes; can bring mother-daughter / unpermitted work up to code; NY is an attorney-closing state (build that into timelines).

LISTING-AGENT REBUTTAL BANK (overcoming resistance to accepting a 203k offer):
- "Takes too long / won't close on time" → the reno is AFTER closing, so it doesn't hold up the closing; we've done 10+ with Team Rizzolo on a normal timeline; happy to have my lender call you.
- "Too restrictive / red tape" → the rules are looser than they used to be (Limited now $75k, less paperwork); I can send literature.
- "We'd rather take the cash/conventional offer" → this is an owner-occupant paying full price; cash investors lowball; your seller nets more, and we take it in ANY condition so you fix nothing.
- "Buyer will nickel-and-dime us on repairs" → opposite — because we FINANCE the repairs, we're not asking you to fix anything or credit us; as-is.
- "FHA won't lend on this house, it's too rough" → that's exactly what a 203k is for; the repairs that would block a normal FHA loan get rolled in.
- "It'll fall apart in underwriting / don't trust the lender" → we've closed 10 of these with Team Rizzolo, it's their bread and butter; want them to reach out and answer your questions?
- "House won't appraise" → the appraisal is on the AFTER-repair value from the plans and bids.

HARD RULES: Never quote specific interest rates, APRs, or payment amounts, and never promise or guarantee an approval. For any real numbers or a real qualification, route them to TEAM RIZZOLO ("let me have my lender reach out" / "Team Rizzolo can run the actual numbers"). If you are not certain about a guideline, say to confirm with Team Rizzolo rather than guessing.
`.trim();

function systemFor(mode: string, persona: string): string {
  const who = persona === "agent" ? "listing agent" : "home buyer (client)";
  if (mode === "coach") {
    const focus = persona === "agent"
      ? `The agent wants help OVERCOMING A LISTING AGENT'S resistance to accepting their buyer's 203k offer. Give them the exact rebuttal to say, grounded in the rebuttal bank.`
      : `The agent wants help EXPLAINING the 203k to a home BUYER in a way that excites them. Give them plain, ready-to-say language.`;
    return `${KB}

YOUR ROLE: You are a 203k COACH for a real-estate agent (the user). ${focus}
Give short, confident, plain-English language they can actually SAY out loud — not a lecture. Use their words back to them. Prefer 2-5 sentences plus, if useful, a couple of bulletized talking points.
End coaching answers by reminding them to loop in Team Rizzolo for the real numbers. Follow the HARD RULES.`;
  }
  // roleplay
  const persInstr = persona === "agent"
    ? `Role-play a RESISTANT LISTING AGENT. The user is the BUYER'S agent trying to get you to accept their client's 203k offer over other offers. Push back with realistic objections (203k is too slow, a cash offer is cleaner, too much red tape, the house won't appraise, the buyer will nitpick repairs). Make them earn it — only warm up / concede when they give a solid, ACCURATE rebuttal.`
    : `Role-play a realistic HOME BUYER talking to their agent (the user) about a fixer-upper and financing. Be a bit skeptical or just green: raise real buyer worries ("I don't have money to renovate after buying", "sounds complicated", "how much down?", "what can it even pay for?"). Warm up as they explain it well.`;
  return `${KB}

YOUR ROLE: This is a PRACTICE ROLEPLAY. ${persInstr}
Stay fully in character as the ${who} — do NOT coach or explain the product yourself. Keep replies conversational and short (1-4 sentences). Raise objections that are REALISTIC and grounded in the facts above so the agent gets real practice.
EXCEPTION: if the user asks for a tip or types "coach", briefly step out of character (start that line with "Coach:") and give ONE concrete pointer, then resume in character on the next message.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not set" }, 400);
    const b = await req.json().catch(() => ({}));
    const mode = b.mode === "roleplay" ? "roleplay" : "coach";
    const persona = b.persona === "agent" ? "agent" : "client";
    const history = Array.isArray(b.history) ? b.history : [];
    const messages = history
      .filter((m: { text?: string }) => m && m.text)
      .map((m: { who: string; text: string }) => ({ role: m.who === "bot" ? "assistant" : "user", content: String(m.text) }));
    // Fresh roleplay: seed a hidden opener so the bot speaks first, in character.
    if (!messages.length) {
      messages.push({ role: "user", content: mode === "roleplay" ? "(Start the roleplay — give me your opening line in character.)" : "Hi" });
    }
    const reply = await callClaude(systemFor(mode, persona), messages, 600);
    return json({ reply });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
