import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Voice-and-style guidance for the project narrative. Cached so we
// don't pay for the rulebook on every submission. The model is given
// real latitude to vary openings, switch between "we" and "the
// technician", and add brief atmosphere — what's locked down is the
// no-fabrication / no-marketing-fluff floor.
const SYSTEM = `You write project case-study narratives for My Window Washing, a residential exterior cleaning company in the Chicago and North Shore area. Each narrative documents one specific job our crew delivered at a real address.

Output two paragraphs of plain text separated by a single blank line. No headings, no markdown, no preamble, no quotation marks. Aim for 90-130 words per paragraph; flexibility within that range is fine.

VOICE
- Write the way a craftsman who took pride in the day's work would describe it: specific, grounded, calmly confident, no flourishes.
- Past tense. You can use first-person plural ("our crew", "we") or third-person ("the technician", "our team") — pick whichever flows better for the piece and stay consistent inside it.
- Vary how you open across different narratives. Do NOT always start with "This project", "Our technician went to", or "The home in X". Sometimes lead with the house itself, the season's particular debris pattern, the neighborhood's character, what the customer asked for, the condition we found on arrival, or the property's setting.
- One vivid concrete detail beats three vague ones. Name specific elements when they appear in the input: divided-light French casements, north-facing exposure, exterior storm panels, the muntin grid, etc.
- Brief atmospheric touches add life — a phrase about the season's debris, the morning light, lake-effect grit, oak-canopy shading, mature street trees, an older brick building stock — but only when they fit naturally. Don't force scenery.

STRUCTURE
- Paragraph 1: orient the reader. Where the job was, what kind of property, why the cleaning was needed, the customer relationship if mentioned. Light scene-setting allowed.
- Paragraph 2: what we actually did. The specific approach, any challenge addressed, the rhythm of the day, how it was completed, how we handled communication or invoicing.

GROUNDING (strict — non-negotiable)
- Never invent facts. If the tech's notes don't mention something (e.g. screens, customer history, a second story, ladder use), don't include it.
- Use exact numbers and descriptions provided. If the tech said 24 windows and 8 skylights, use 24 and 8.
- If a detail isn't clear from the input, leave it out rather than guess.

FORBIDDEN
- Praise words: "great job", "excellent results", "amazing", "perfect", "stunning", "transformation", "beautiful", "pristine". Praise belongs in the customer review, not in our voice.
- Marketing voice: "We at My Window Washing pride ourselves...", "the best service in...", "contact us today", "trust the experts".
- Year in the body text — the date is rendered separately.
- The customer's full name.
- Sales calls-to-action of any kind.

NEARBY CONTEXT
- You may be given a list of nearby towns or neighborhoods. Use them ONLY when it adds something — e.g. "tucked into the stretch of older brick homes between Naperville and Aurora", "this corner of Romeoville sits just east of Bolingbrook's older subdivisions". Never as a list, never as filler. If nothing fits naturally, ignore them.

EXAMPLE OF THE VOICE WE WANT (don't copy literally — use it as a tonal anchor)

> The ravine homes on Highland Park's north side are tough on glass. Wind off the lake carries fine grit that bonds to anything south-facing, and this two-story contemporary's main wall took the worst of it through the spring. The owners had asked for a full clean before their daughter's June graduation party — a fair deadline that gave us three working windows to plan around.
>
> We worked the exterior first while the morning light stayed soft, then moved indoors after eleven once the south face caught real heat. The seventeen-foot dining-room glass came down through a water-fed pole rig in the yard; screens off one by one, through the bucket bath, back in place. The kitchen and family-room casements were straightforward — frame wipe, track vacuum, squeegee. Wrapped at four-thirty, invoice in her inbox by five.

Notice in that example: a specific opening that isn't "This project". Real concrete detail. First-person plural throughout. Atmospheric touch ("wind off the lake carries fine grit") that's anchored to the location. No marketing language. No praise. Time of day and method, not abstract claims.`;

export async function generateNarrative({
  service,         // "Window Washing"
  city,            // "Romeoville, IL"
  homeType,        // "3-Story House"
  metric,          // "43 Windows Cleaned"
  challenges,      // array of structured challenges the tech ticked
  bulletFacts,     // free-text dump of what tech entered
  extras,          // service-specific structured fields (window types, screens, etc.)
  nearbyTowns,     // array of nearby spoke names for local color
}) {
  const challengeList = Array.isArray(challenges) ? challenges : (challenges ? [challenges] : []);

  const userPrompt = `Job facts:
- Service: ${service}
- Location: ${city}
- Home type: ${homeType || 'not specified'}
- Primary metric: ${metric || 'not specified'}
- Nearby towns / neighborhoods (use sparingly for local color, only if it fits naturally): ${nearbyTowns?.length ? nearbyTowns.join(', ') : 'none provided'}
${formatExtras(extras)}${formatChallenges(challengeList)}
Technician's notes (raw — these are the only facts you have to work with):
"""
${bulletFacts || '(none)'}
"""

Write the two paragraphs now, following the voice guidance in the system prompt. Vary the opening — do not start with "This project" or "Our technician".`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    // Slightly higher temperature for natural variation across pages.
    temperature: 0.9,
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

  // Split into 2 paragraphs for the template.
  const paragraphs = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  return paragraphs;
}

// Format the checked-challenges list as a labeled section the model
// can reference. The instruction encourages weaving rather than
// listing — the writeup shouldn't read like a checklist dump.
function formatChallenges(challenges) {
  if (!challenges || challenges.length === 0) return '';
  return `\nChallenges this job presented (weave naturally into the work paragraph as conditions our crew dealt with — do NOT list them mechanically):\n${challenges.map(c => `- ${c}`).join('\n')}\n`;
}

// Turn the service-specific extras object into a few bullet lines the
// model can ground on. Skips empty fields so the prompt stays tight.
// Branches by which fields are present rather than by service value,
// so a future service can fill in the same shape and have its details
// flow through automatically.
function formatExtras(extras) {
  if (!extras || typeof extras !== 'object') return '';
  const lines = [];
  if (extras.serviceType) lines.push(`- Service type: ${extras.serviceType}`);

  // Window-cleaning fields
  if (Array.isArray(extras.windowTypes) && extras.windowTypes.length) {
    lines.push(`- Window types present: ${extras.windowTypes.join(', ')}`);
  }
  if (extras.screens)      lines.push(`- Screens washed: ${extras.screens}`);
  if (extras.stormWindows) lines.push(`- Storm windows cleaned: ${extras.stormWindows}`);
  if (extras.skylights)    lines.push(`- Skylights cleaned: ${extras.skylights}`);
  if (extras.windowWells)  lines.push(`- Window wells cleaned: ${extras.windowWells}`);
  if (extras.tracksFrames) lines.push(`- Tracks and frames wiped down`);

  // Gutter-cleaning fields
  if (extras.sqFootage && !extras.surfaces) {
    lines.push(`- Approximate home footprint: ${extras.sqFootage} sq ft`);
  }
  if (extras.gutterGuards)     lines.push(`- Gutter guards involved`);
  if (extras.roofCleaning)     lines.push(`- Roof cleaning included`);
  if (extras.gutterRepairs) {
    const list = Array.isArray(extras.gutterRepairTypes) && extras.gutterRepairTypes.length
      ? ` (${extras.gutterRepairTypes.join(', ')})` : '';
    lines.push(`- Gutter repairs performed${list}`);
  }
  if (extras.extraWideGutters) lines.push(`- Extra-wide gutters on this property`);
  if (extras.cloggedElbows)    lines.push(`- Clogged elbows that needed clearing`);
  if (extras.undergroundClogs) lines.push(`- Underground drain clogs that needed clearing`);

  // Power-washing fields. Surfaces ticked + their materials so the
  // narrative can name each one specifically rather than generalizing.
  if (extras.surfaces) {
    const s = extras.surfaces;
    if (s.house) {
      const story = extras.houseStories ? `${extras.houseStories}-story ` : '';
      const mats  = Array.isArray(extras.houseMaterials) && extras.houseMaterials.length
        ? ` (${extras.houseMaterials.join(', ')})` : '';
      lines.push(`- ${story}House washed${mats}`);
    }
    if (s.deck) {
      const mats = Array.isArray(extras.deckMaterials) && extras.deckMaterials.length
        ? ` (${extras.deckMaterials.join(', ')})` : '';
      lines.push(`- Deck washed${mats}`);
    }
    if (s.patio) {
      const mats = Array.isArray(extras.patioMaterials) && extras.patioMaterials.length
        ? ` (${extras.patioMaterials.join(', ')})` : '';
      lines.push(`- Patio washed${mats}`);
    }
    if (s.driveway) {
      const mats = Array.isArray(extras.drivewayMaterials) && extras.drivewayMaterials.length
        ? ` (${extras.drivewayMaterials.join(', ')})` : '';
      lines.push(`- Driveway washed${mats}`);
    }
    if (s.walkways) {
      const mats = Array.isArray(extras.walkwaysMaterials) && extras.walkwaysMaterials.length
        ? ` (${extras.walkwaysMaterials.join(', ')})` : '';
      lines.push(`- Walkways washed${mats}`);
    }
    if (s.playset)          lines.push(`- Playset washed`);
    if (s.outdoorFurniture) lines.push(`- Outdoor furniture washed`);
    if (extras.sqFootage)   lines.push(`- Approximate area cleaned: ${extras.sqFootage} sq ft`);
  }

  return lines.length ? '\nExtras:\n' + lines.join('\n') + '\n' : '';
}
