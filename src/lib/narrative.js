import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// SOP §4 Section 5 narrative rules, embedded verbatim so a model swap
// can't drift the voice. Cached via `cache_control` so we don't pay for
// the whole rulebook on every form submission.
const SYSTEM = `You write project-page narratives for My Window Washing, a
residential exterior cleaning company in the Chicago / North Shore area.

You will produce exactly two paragraphs of plain text. Output ONLY the
two paragraphs separated by a single blank line — no headings, no
markdown, no preamble, no quotation marks.

Voice and content rules (strict):
- Paragraph 1 = context: home type, location details, why the job was
  needed, customer relationship if mentioned.
- Paragraph 2 = execution: what the technician actually did, any
  specific challenge addressed, how the job was completed, communication
  or invoicing detail at the end.
- ~100 words per paragraph, 90-115 acceptable.
- Be specific. Name compass directions of windows when given, second-
  story equipment if mentioned, special techniques if mentioned.
- NEVER use filler language like "great job", "excellent results",
  "amazing", "perfect", "stunning". Praise belongs in the customer
  review, not in our voice.
- NEVER fabricate facts not in the input. If the tech did not mention
  something (e.g. screens), do not invent it.
- Write in past tense, third person ("Our technician..."), the way a
  craftsman would describe their own day's work.
- Do not name the customer.
- Do not put years in the body text; the date is rendered separately.`;

export async function generateNarrative({
  service,         // "Window Washing"
  city,            // "Northbrook, IL"
  homeType,        // "Two-story colonial"
  metric,          // "24 windows"
  challenge,       // free-text from tech
  bulletFacts,     // free-text dump of what tech entered
  customerNote,    // optional, e.g. "annual client"
}) {
  const userPrompt = `Job facts:
- Service: ${service}
- Location: ${city}
- Home type: ${homeType || 'not specified'}
- Primary metric: ${metric || 'not specified'}
- Notable challenge: ${challenge || 'none mentioned'}
- Customer context: ${customerNote || 'none mentioned'}

Technician's notes (raw):
"""
${bulletFacts || '(none)'}
"""

Write the two paragraphs now, following the rules in the system prompt.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
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
