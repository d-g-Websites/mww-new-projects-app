// Lightweight Telegram notifier. Used to alert the admin chat when a
// tech saves a project for approval. Silent no-op when not configured,
// so dev environments don't need to wire up a bot.

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT  = () => process.env.TELEGRAM_CHAT_ID   || '';

// We send Markdown-flavored text; escape the chars Telegram treats as
// formatting (legacy Markdown mode) inside dynamic strings.
function md(s) {
  return String(s || '').replace(/([_*`\[])/g, '\\$1');
}

export async function notifyTelegram(text, { silent = false } = {}) {
  if (!TOKEN() || !CHAT()) {
    console.log('[telegram] not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID), skipping');
    return { skipped: true };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT(),
        text,
        parse_mode: 'Markdown',
        disable_notification: silent,
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[telegram] send failed:', res.status, body);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error('[telegram] error:', err.message);
    return { ok: false, error: err.message };
  }
}

export function notifyNewProject(project) {
  const base = process.env.DASHBOARD_BASE_URL || 'https://project.mywindowwashing.com';
  const url  = `${base.replace(/\/$/, '')}/projects/${project.id}/preview`;
  const lines = [
    '*New project submitted for approval*',
    '',
    `*Service:* ${md(project.service_label)}`,
    `*City:* ${md(project.city_name)}, IL`,
    `*Hub:* ${md(project.hub)}`,
    `*Slug:* \`${md(project.slug)}\``,
  ];
  if (project.address) lines.push(`*Address:* ${md(project.address)}`);
  if (project.price)   lines.push(`*Price:* ${md(project.price)}`);
  lines.push('', `Review & publish: ${url}`);
  return notifyTelegram(lines.join('\n'));
}

// A tech changed a project after submitting it. `changes` is a list
// of short human-readable lines ("Video added: https://…").
export function notifyProjectUpdate({ project, user, changes, live = false }) {
  const base = (process.env.DASHBOARD_BASE_URL || 'https://project.mywindowwashing.com').replace(/\/$/, '');
  const link = project.status === 'published'
    ? `${base}/projects/${project.id}/edit`
    : `${base}/projects/${project.id}/preview`;
  const lines = [
    `*Project updated by ${md(user.display_name)}*`,
    '',
    `*Project:* ${md(project.service_label)} — ${md(project.city_name)}, IL`,
    `*Status:* ${md(project.status)}`,
    `*Slug:* \`${md(project.slug)}\``,
    '',
    '*What changed:*',
    ...changes.map(c => `• ${md(c)}`),
  ];
  if (live) {
    lines.push('', 'The change is already on the live page.');
  } else if (project.status === 'published') {
    lines.push('', 'Saved to the dashboard only — the live page will pick it up on the next republish.');
  }
  lines.push('', `Review: ${link}`);
  return notifyTelegram(lines.join('\n'));
}
