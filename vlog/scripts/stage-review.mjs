#!/usr/bin/env node
import { resolve } from 'node:path';
import { startReview, reviewStatus, resolveFeedback, STAGE_FILES } from '../lib/stage-review.mjs';
import { serveReview } from '../lib/stage-review-server.mjs';

const [command, ...argv] = process.argv.slice(2);
const opt = key => {
  const i = argv.indexOf('--' + key);
  return i < 0 ? null : argv[i + 1];
};
const stage = opt('stage'), run = opt('run') && resolve(opt('run'));
const usage = 'Usage: node scripts/stage-review.mjs <serve|status|start|resolve> --stage <visioner|director|editor|producer> --run <absolute canonical vlog/runs/episode>';
if (!STAGE_FILES[stage] || !run || !['serve', 'status', 'start', 'resolve'].includes(command)) {
  console.error(usage);process.exit(2);
}
try {
  if (command === 'serve') {
    const { url } = await serveReview({ stage, runRoot: run, port: Number(opt('port') ?? 0) });
    // Browser access is limited to loopback on the host. Treat URL token as private.
    console.log(JSON.stringify({ stage, run, url, reviewType: reviewStatus(run, stage).reviewType,
      message: 'Open in browser on the host. No approval is implied by opening the page.' }));
  } else if (command === 'resolve') {
    console.log(JSON.stringify(resolveFeedback(run, stage, {
      feedbackRevisionId: opt('feedback-revision'),
      feedbackKey: opt('feedback-key'), disposition: opt('disposition'),
      explanation: opt('explanation'),
    }), null, 2));
  } else {
    const state = command === 'start' ? startReview(run, stage) : reviewStatus(run, stage);
    console.log(JSON.stringify(state, null, 2));
  }
} catch (error) {console.error(error.message);process.exit(1);}
