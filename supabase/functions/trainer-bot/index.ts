// Supabase Edge Function: trainer-bot
// Powers the AI Robot Trainer (Training Studio). Two actions:
//   action:"reply" → Claude role-plays the borrower/partner in character at a chosen
//                    difficulty (1 cooperative → 10 hostile/suspicious).
//   action:"grade" → Claude grades the trainee's call transcript against THIS call
//                    type's rubric (the metrics passed in) and returns a JSON scorecard.
//
// Auth: called from the Trainer tab with the project publishable key (Verify JWT OFF).
// Anthropic key lives in Secrets (reuses ANTHROPIC_API_KEY).
//
// DEPLOY: Supabase dashboard → Edge Functions → new function named "trainer-bot" with
// this body; reuses ANTHROPIC_API_KEY; Verify JWT OFF.

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

async function callClaude(system: string, messages: unknown[], maxTokens = 700) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error("Claude API " + res.status + ": " + (await res.text()));
  const data = await res.json();
  return (data?.content?.[0]?.text ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const action = b.action || "reply";
    const trackLabel = b.trackLabel || "team member";
    const scenarioName = b.scenarioName || "call";
    const scenarioDesc = b.scenarioDesc || "";
    const difficulty = Math.max(1, Math.min(10, Number(b.difficulty) || 5));
    const history = Array.isArray(b.history) ? b.history : [];

    if (action === "grade") {
      const metrics = Array.isArray(b.metrics) ? b.metrics : [];
      const elapsed = b.elapsedMinutes != null ? Math.round(Number(b.elapsedMinutes) * 10) / 10 : null;
      const transcript = history.map((m: { who: string; text: string }) =>
        (m.who === "bot" ? "CLIENT" : "TRAINEE") + ": " + m.text).join("\n");
      const rubric = metrics.map((m: { name: string; desc: string }) => `- ${m.name}: ${m.desc}`).join("\n");
      const sys = `You are an expert mortgage CALL COACH grading a trainee's handling of a practice phone call in a training simulator.
Call type: "${scenarioName}" — handled by a ${trackLabel}. ${scenarioDesc}
${elapsed != null ? `The call lasted approximately ${elapsed} minute(s) of real time. Use this for any call-length/duration metric.` : ""}
Grade ONLY against this rubric. Score each metric 0-5 (5 = excellent, fully done; 0 = not done) and mark "met" true only if it was clearly accomplished:
${rubric}
Be fair but honest. Reward specific, compliant, client-centered handling; penalize vague, robotic, pushy, or non-compliant moves (e.g. guaranteeing an unlocked rate). Keep notes to one concrete sentence each.
Return ONLY valid JSON — no markdown, no prose before or after — in EXACTLY this shape:
{"overall": <integer 0-100>, "summary": "<2-3 sentence assessment>", "metrics": [{"name": "<exact metric name>", "score": <0-5>, "met": <true|false>, "note": "<one sentence>"}], "strengths": ["<short>", "..."], "improvements": ["<short>", "..."]}`;
      const userMsg = `TRANSCRIPT:\n${transcript || "(no conversation took place)"}`;
      const raw = await callClaude(sys, [{ role: "user", content: userMsg }], 1100);
      let parsed: unknown;
      try {
        const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
        parsed = JSON.parse(s >= 0 && e >= 0 ? raw.slice(s, e + 1) : raw);
      } catch (_) {
        return json({ error: "Could not parse grade", raw }, 200);
      }
      return json({ grade: parsed });
    }

    // action: reply  → in-character bot
    const sys = `You are role-playing a realistic person in a mortgage TRAINING SIMULATOR. You are the CLIENT (the borrower, or a referral partner) on a phone call. The trainee is a ${trackLabel} at a mortgage branch practicing this call: "${scenarioName}". ${scenarioDesc}
Difficulty is ${difficulty}/10, where 1 = warm, cooperative and easy; 5 = normal with a few honest questions; 10 = guarded, skeptical, impatient or hostile. Calibrate your patience, warmth, objections, and willingness to share information to exactly ${difficulty}.
RULES:
- Stay 100% in character as the client. Never coach, never break character, never say you are an AI or in a simulation.
- Talk like a real person on the phone: usually 1-3 sentences, natural and conversational.
- You know YOUR own situation well, but have only normal-person knowledge of mortgages — ask the questions a real client would ask.
- React to the trainee: warm up and share more if they build rapport, listen, and add real value; stay guarded, vague, or pushy-back if they're robotic, scripted, evasive, or fail to answer you.
- If asked to greet/open, start the call the way this type of client naturally would.
Respond with ONLY your spoken line — no narration, no stage directions, no quotation marks.`;

    const msgs = history.map((m: { who: string; text: string }) => ({
      role: m.who === "bot" ? "assistant" : "user",
      content: m.text,
    }));
    const userText = (b.userText || "").trim();
    if (userText) msgs.push({ role: "user", content: userText });
    if (!msgs.length || msgs[0].role !== "user") {
      // Need a leading user turn to open; nudge the bot to start the call.
      msgs.unshift({ role: "user", content: "(The trainee has just connected. Open the call as this client would.)" });
    }
    const reply = await callClaude(sys, msgs, 350);
    return json({ reply });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
