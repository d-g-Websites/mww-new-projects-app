import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// FAQ generator. Produces 4 Q&A pairs per project that:
//   - mirror real Google search queries for this service in this city
//   - are grounded in the project's specific facts (price, time,
//     surfaces, challenges, etc.) when those facts exist
//   - end with a phone-call CTA in the LAST answer (and only the
//     last) so the FAQ doubles as a conversion surface without
//     spammy repetition
//
// Cached system prompt keeps the rulebook cheap on every submission.
const SYSTEM = `You generate FAQ entries for completed-project pages on a home services website (My Window Washing — Chicago / North Shore / suburbs). Each FAQ helps homeowners researching this type of service in this city find concrete, useful answers.

Output exactly 4 question-answer pairs as a JSON array. Output ONLY the JSON — no surrounding text, no markdown, no preamble, no code fences.

Each entry: { "q": "...", "a": "..." }

Questions
- Phrase them the way a homeowner would actually type into Google. Short, direct, lowercased after the first word.
- At least ONE question must mention the city by name (so the page ranks for "[service] cost [city]" type queries).
- Cover four different angles. Don't ask two cost questions or two duration questions.
- Recommended coverage (any order):
  1. Cost in this city, mentioning the city name
  2. Time / duration for a project of this size
  3. What's specifically included for this type of service / property
  4. A service-specific concern:
     - Window cleaning → "do you clean screens?", "do you do exterior only?", "do you clean high windows?"
     - Gutter cleaning → "how often should gutters be cleaned?", "do you repair gutters too?", "what about underground drains?"
     - Power washing → "is power washing safe for [surface type]?", "do you use chemicals?", "what's the difference between soft wash and pressure wash?"

Answers
- 2-3 sentences. Specific. Factual. Use the project's actual facts when relevant ("This 24-window job took our team under 4 hours and ran $290.").
- When the project doesn't have a specific number (e.g. price not shown), give a realistic typical range for the Chicago area instead of "it depends".
- Same craftsman-direct register as our project narratives. No "We pride ourselves...". No "Look no further!". No "contact us today" except in the final answer's required CTA.
- Don't invent prices, durations, or specifics that aren't in the input. If the field is missing, generalize.
- Past tense when describing the documented project. Present tense when answering general about-our-service questions.

The LAST answer MUST end with exactly:
  "For a quote, call our [hub name] team at [phone]."
…using the hub name and phone provided. Do not include the CTA in any other answer.

Forbidden in every answer
- Year in body text.
- The customer's full name.
- Marketing exclamations ("amazing", "outstanding", "the best").
- Repeating the question verbatim as the start of the answer.

Strict output rules
- The response is a JSON array. Parsing must not fail. No trailing commas. No comments. No surrounding code fences.`;

function clamp(s, n) { return (s || '').slice(0, n); }

export async function generateFaq({
  service,        // "Window Washing"
  city,           // "Romeoville, IL"
  homeType,       // "2-Story House"
  metric,         // "43 Windows Cleaned"
  price,          // "$290" or null
  hubName,        // "Lisle"
  hubPhone,       // "(630) 425-0678"
  extras,         // service-specific structured extras object
  challenges,     // array of challenge labels
  serviceValue,   // "window-cleaning" / "gutter-cleaning" / "power-washing"
}) {
  const facts = [];
  facts.push(`- Service: ${service}`);
  facts.push(`- City: ${city}`);
  if (homeType) facts.push(`- Property type: ${homeType}`);
  if (metric)   facts.push(`- Primary metric: ${metric}`);
  if (price)    facts.push(`- This project's price: ${price}`);
  facts.push(`- Hub office: ${hubName}, phone ${hubPhone}`);
  if (Array.isArray(challenges) && challenges.length) {
    facts.push(`- Challenges encountered on this job: ${challenges.join('; ')}`);
  }
  const extrasSummary = summarizeExtras(serviceValue, extras);
  if (extrasSummary) facts.push(`- Extras / surface details: ${extrasSummary}`);

  const userPrompt = `Project facts:
${facts.join('\n')}

Generate the 4 Q&A pairs now as a JSON array. Remember: at least one question mentions ${city} by name, and the LAST answer ends with "For a quote, call our ${hubName} team at ${hubPhone}." exactly.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    temperature: 0.7,
    system: [{
      type: 'text',
      text: SYSTEM,
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = res.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  // Strip code fences if the model emits them despite the rule.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('[faq] JSON parse failed:', err.message);
    console.error('[faq] raw response:', clamp(text, 500));
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(item => item && typeof item.q === 'string' && typeof item.a === 'string')
    .map(item => ({ q: item.q.trim(), a: item.a.trim() }))
    .slice(0, 6);
}

// Brief summary of the service-specific extras the model needs to
// produce a "what's included" answer. Doesn't try to be exhaustive —
// just the headline facts.
function summarizeExtras(serviceValue, extras) {
  if (!extras || typeof extras !== 'object') return '';
  const bits = [];
  if (extras.serviceType) bits.push(extras.serviceType);
  // Window cleaning
  if (Array.isArray(extras.windowTypes) && extras.windowTypes.length) bits.push(`window types: ${extras.windowTypes.join(', ')}`);
  if (extras.screens)      bits.push(`${extras.screens} screens`);
  if (extras.stormWindows) bits.push(`${extras.stormWindows} storm windows`);
  if (extras.skylights)    bits.push(`${extras.skylights} skylights`);
  // Gutter cleaning
  if (extras.gutterGuards)     bits.push('gutter guards');
  if (extras.roofCleaning)     bits.push('roof cleaning');
  if (extras.gutterRepairs)    bits.push('gutter repairs');
  if (extras.extraWideGutters) bits.push('extra-wide gutters');
  if (extras.cloggedElbows)    bits.push('clogged elbows');
  if (extras.undergroundClogs) bits.push('underground drain clogs');
  // Power washing
  if (extras.surfaces) {
    const s = extras.surfaces;
    const surfaces = [];
    if (s.house)            surfaces.push('house');
    if (s.deck)             surfaces.push('deck');
    if (s.patio)            surfaces.push('patio');
    if (s.driveway)         surfaces.push('driveway');
    if (s.walkways)         surfaces.push('walkways');
    if (s.playset)          surfaces.push('playset');
    if (s.outdoorFurniture) surfaces.push('outdoor furniture');
    if (surfaces.length)    bits.push(`surfaces washed: ${surfaces.join(', ')}`);
    if (extras.sqFootage)   bits.push(`~${extras.sqFootage} sq ft`);
  }
  return bits.join(' · ');
}
