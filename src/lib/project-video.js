// Delete a project's YouTube video from the company channel. Shared by
// the "Delete video from YouTube" button and full project deletion.
//
// Returns one of:
//   { status: 'none' }                   project has no video
//   { status: 'not-youtube', url }       e.g. a Vimeo link — nothing to delete
//   { status: 'shared', url, others }    another project embeds the same video;
//                                        left on YouTube on purpose
//   { status: 'deleted', url }           removed from YouTube
//   { status: 'already-gone', url }      wasn't on YouTube any more
//   { status: 'failed', url, error }     YouTube refused / errored
//
// Only touches YouTube. Clearing project.video_url and re-publishing the
// page are the caller's job.

import { listProjectsWithVideo } from './db.js';
import { youtubeIdFromUrl, deleteVideo } from './youtube.js';

export async function deleteProjectVideo(project) {
  const url = project?.video_url;
  if (!url) return { status: 'none' };
  const videoId = youtubeIdFromUrl(url);
  if (!videoId) return { status: 'not-youtube', url };

  const others = listProjectsWithVideo()
    .filter(p => p.id !== project.id && youtubeIdFromUrl(p.video_url) === videoId)
    .map(p => `${p.service_label} — ${p.city_name}, IL`);
  if (others.length) return { status: 'shared', url, others };

  const result = await deleteVideo(videoId);
  if (!result.ok) return { status: 'failed', url, error: result.error };
  return { status: result.alreadyGone ? 'already-gone' : 'deleted', url };
}
