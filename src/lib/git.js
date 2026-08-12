import simpleGit from 'simple-git';

function authoredGit(siteRepoPath) {
  const author = process.env.GIT_AUTHOR_NAME || 'MWW Dashboard';
  const email  = process.env.GIT_AUTHOR_EMAIL || 'dashboard@mywindowwashing.com';
  return simpleGit(siteRepoPath, {
    config: [
      `user.name=${author}`,
      `user.email=${email}`,
    ],
  });
}

// Pull the static-site repo into a clean state before we start writing
// the new project page. We always want our spoke/sitemap patches to be
// based on the live `origin/branch`, never on a stale local copy
// that another writer (GitHub UI, cPanel, another sysadmin) has
// diverged from. Reset --hard is safe here because the dashboard's
// local clone is staging-only — nothing of value lives outside `origin`.
export async function syncSiteRepo({ siteRepoPath, branch }) {
  const git = authoredGit(siteRepoPath);
  await git.fetch('origin', branch);
  const status = await git.status();
  if (status.current !== branch) {
    await git.checkout(branch);
  }
  await git.reset(['--hard', `origin/${branch}`]);
  await git.clean('f', ['-d']);
}

// Commit the generated artifacts and push to the deploy branch.
// On a non-fast-forward rejection (someone else pushed between our
// sync and our push), fetch + rebase our single commit on top of
// origin and retry. Genuine network errors retry with exponential
// backoff.
export async function commitAndPush({ siteRepoPath, branch, files, message, push }) {
  const author = process.env.GIT_AUTHOR_NAME || 'MWW Dashboard';
  const email  = process.env.GIT_AUTHOR_EMAIL || 'dashboard@mywindowwashing.com';
  const git = authoredGit(siteRepoPath);

  const status = await git.status();
  if (status.current !== branch) {
    await git.checkout(branch);
  }

  await git.add(files);
  const commit = await git.commit(message, undefined, {
    '--author': `${author} <${email}>`,
  });

  let pushResult = null;
  if (push) {
    pushResult = await pushWithRetry(git, branch);
  }
  return { sha: commit.commit, push: pushResult };
}

async function pushWithRetry(git, branch, attempts = 4) {
  const delays = [2000, 4000, 8000, 16000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await git.push('origin', branch, ['-u']);
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      const rejected = /rejected|fetch first|non-fast-forward/i.test(msg);
      const network  = /could not resolve|temporarily unavailable|timed out|connection refused/i.test(msg);

      if (rejected && i < attempts - 1) {
        // Remote moved between our sync and our push. Replay our
        // commit on top of origin and try again — no sleep, this
        // resolves immediately.
        await git.fetch('origin', branch);
        await git.rebase([`origin/${branch}`]);
        continue;
      }
      if (network && i < attempts - 1) {
        await sleep(delays[i]);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
