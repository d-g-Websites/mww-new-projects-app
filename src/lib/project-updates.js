// Records a change a tech made to a project after submitting it:
// writes it to the activity log (admin dashboard card) and pings the
// admin Telegram chat.
//
// Skipped when:
//   - the change was made by an admin (they don't need to notify
//     themselves), or
//   - the project is still a draft (unsubmitted work — the admin
//     hasn't seen it yet and will get the normal "submitted" ping).

import { logActivity } from './db.js';
import { notifyProjectUpdate } from './telegram.js';

// `live` = the change was already pushed to the published page.
export function recordTechUpdate(project, user, changes, { live = false } = {}) {
  if (!project || !user || !changes || changes.length === 0) return;
  if (user.role === 'admin') return;
  if (project.status === 'draft') return;

  try {
    logActivity({
      projectId: project.id,
      userId: user.id,
      summary: changes.join(' · '),
    });
  } catch (err) {
    console.error('[activity] log failed:', err.message);
  }

  // Fire-and-forget: a Telegram hiccup must never fail the tech's save.
  notifyProjectUpdate({ project, user, changes, live }).catch(err =>
    console.error('[telegram] update notify failed:', err.message)
  );
}
