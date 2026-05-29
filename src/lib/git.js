import simpleGit from 'simple-git';

// Commit the generated artifacts and push to the deploy branch.
// cPanel pulls from that branch on its own schedule (or via a webhook
// the user wires up separately).
export async function commitAndPush({ siteRepoPath, branch, files, message, push }) {
  const git = simpleGit(siteRepoPath);

  // Make sure we're on the expected branch.
  const status = await git.status();
  if (status.current !== branch) {
    await git.checkout(branch);
  }

  await git.add(files);
  const author = process.env.GIT_AUTHOR_NAME || 'MWW Dashboard';
  const email  = process.env.GIT_AUTHOR_EMAIL || 'dashboard@mywindowwashing.com';
  const commit = await git.commit(message, undefined, {
    '--author': `${author} <${email}>`,
  });

  let pushResult = null;
  if (push) {
    pushResult = await retryPush(git, branch);
  }
  return { sha: commit.commit, push: pushResult };
}

async function retryPush(git, branch, attempts = 4) {
  const delays = [2000, 4000, 8000, 16000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await git.push('origin', branch, ['-u']);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delays[i]);
    }
  }
  throw lastErr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
