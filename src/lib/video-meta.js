// AI-generated YouTube title + description + tags for job videos.
// Same Claude account as the narrative writer, but a different task:
// short, search-friendly metadata grounded in the project's facts.

import Anthropic from '@anthropic-ai/sdk';
import { getHub } from './slug.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const SYSTEM = `You write YouTube metadata for short job-site videos from My Window Washing, a residential exterior cleaning company serving Chicago and its suburbs. Each video documents one real completed job (window cleaning, gutter cleaning, or power washing).

Return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
{
  "title": "...",
  "description": "...",
  "tags": ["...", "..."]
}

TITLE rules:
- Max 90 characters.
- Lead with the service + city since that's what people search: e.g. "Window Cleaning in Naperville IL — 24 Windows on a Two-Story Colonial".
- End with "| My Window Washing" if it fits within the limit, otherwise drop it.
- No clickbait, no ALL CAPS, no emoji.

DESCRIPTION rules:
- 3-5 short sentences describing what the video shows, grounded ONLY in the provided job facts. Never invent details.
- Then a blank line, then the project-page link if one was provided (verbatim).
- Then a blank line, then this contact block, substituting the phone number provided:
  My Window Washing — residential window cleaning, gutter cleaning & power washing in Chicago and the suburbs.
  ☎ {phone}
  https://www.mywindowwashing.com
- Plain text only. No hashtags inside sentences (a final line with 2-3 hashtags like #windowcleaning is fine).

TAGS rules:
- 10-15 tags. Mix of: the service ("window cleaning"), service + city ("window cleaning naperville"), city + state ("naperville il"), generic local-service terms ("window washers near me"), and the company name.
- Lowercase, no # symbol.`;

export async function generateVideoMeta({ project, manualContext }) {
  let facts;
  if (project) {
    const hub = project.hub ? getHub(project.hub) : null;
    facts = `Job facts:
- Service: ${project.service_label}
- City: ${project.city_name}, IL
- Home type: ${project.home_type || 'not specified'}
- Primary metric: ${project.metric_value ? `${project.metric_value} ${project.metric_label || ''}`.trim() : 'not specified'}
- Project page link (include verbatim in the description): https://www.mywindowwashing.com/projects/${project.slug}
- Phone for the contact block: ${hub?.phone || '(847) 715-9493'}

Project narrative (your source of truth for what happened on this job):
"""
${project.narrative || project.bullet_facts || '(none)'}
"""`;
  } else {
    facts = `Job facts (entered manually — no linked project page, so omit the project-page link line):
"""
${manualContext || '(none provided — write generic metadata for a My Window Washing job video)'}
"""
- Phone for the contact block: (847) 715-9493`;
  }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    temperature: 0.7,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `${facts}\n\nWrite the JSON now.` }],
  });

  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  // Tolerate accidental code fences.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const meta = JSON.parse(cleaned);
  if (!meta.title || !meta.description) throw new Error('AI returned incomplete metadata');
  meta.tags = Array.isArray(meta.tags) ? meta.tags : [];
  return meta;
}
