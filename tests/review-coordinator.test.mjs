import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ANGLE_SLUGS,
  main,
  runQueue,
  runTrigger,
} from '../skills/blast-radius-buddy/scripts/review-coordinator.mjs';
import * as coordinatorModule from '../skills/blast-radius-buddy/scripts/review-coordinator.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const TRIGGER = {
  repo: 'acme/widget',
  number: 466,
  url: 'https://github.com/acme/widget/pull/466',
  headSha: HEAD,
  triggerId: `head:${HEAD}`,
  triggerKind: 'head',
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const events = [];
  const context = {
    ...TRIGGER,
    diff: 'diff --git a/src/a.ts b/src/a.ts',
    files: [{ path: 'src/a.ts' }],
    changedLines: { 'src/a.ts': [1] },
    priorLedger: '(no prior feedback)',
    requiredChecksPass: true,
  };
  const plan = {
    status: 'complete',
    headSha: HEAD,
    triggerId: TRIGGER.triggerId,
    intent: 'Change one behavior.',
    boundaries: ['runtime'],
    clusters: [{
      id: 'cluster-1',
      risk: 'high',
      reason: 'Shared behavior changes.',
      changedFiles: ['src/a.ts'],
      relatedFiles: [],
      tests: [],
    }],
    fileDispositions: [{
      path: 'src/a.ts',
      disposition: 'material',
      clusterId: 'cluster-1',
      reason: 'Behavior changes.',
    }],
    assignments: [
      { angle: ANGLE_SLUGS[0], provider: 'codex', reason: 'Trust boundary review.' },
      { angle: ANGLE_SLUGS[1], provider: 'claude', reason: 'Highest blast radius.' },
      { angle: ANGLE_SLUGS[2], provider: 'codex', reason: 'Contract review.' },
    ],
    missingContext: [],
  };
  const synthesis = {
    status: 'complete',
    headSha: HEAD,
    triggerId: TRIGGER.triggerId,
    event: 'APPROVE',
    report: {},
    gates: {
      reviewersComplete: true,
      reproductionComplete: true,
      materialUncertainty: false,
      verifierVerdict: 'clean',
      findings: [],
      suggestions: [],
      failedRequiredChecks: [],
      headUnchanged: true,
    },
    verification: {},
  };
  const state = {
    acquire: async () => ({
      acquired: true,
      ownerId: 'owner-1',
      deadlineAt: Date.now() + 30_000,
    }),
    heartbeat: async () => events.push('state:heartbeat'),
    failure: async (_trigger, category) => {
      events.push(`state:failure:${category}`);
      return { nextEligibleAt: 1_900_000_000_000 };
    },
    success: async (trigger) => events.push(`state:success:${trigger.triggerId}`),
    release: async () => events.push('state:release'),
  };
  const marker = {
    working: async () => events.push('marker:working'),
    retry: async ({ reason }) => events.push(`marker:retry:${reason}`),
    incomplete: async ({ reason }) => events.push(`marker:incomplete:${reason}`),
    stale: async () => events.push('marker:stale'),
    complete: async ({ trigger }) => events.push(`marker:complete:${trigger.triggerId}`),
  };
  const github = {
    capture: async () => context,
    recheck: async () => ({ headSha: HEAD, requiredChecksPass: true }),
    submit: async ({ trigger }) => {
      events.push(`github:submit:${trigger.triggerId}`);
      return {
        event: 'APPROVE',
        reviewUrl: 'https://github.com/acme/widget/pull/466#pullrequestreview-9',
      };
    },
  };
  const workspace = {
    create: async ({ inspect }) => {
      events.push('workspace:create');
      return inspect({
        root: '/tmp/review-workspace',
        checkout: '/tmp/review-workspace/checkout',
        artifacts: {
          pr: '/tmp/review-workspace/artifacts/pr.json',
          diff: '/tmp/review-workspace/artifacts/diff.patch',
          changedLines: '/tmp/review-workspace/artifacts/changed-lines.json',
          priorFeedback: '/tmp/review-workspace/artifacts/prior-feedback.md',
          agentRules: '/tmp/review-workspace/artifacts/agent-rules.json',
        },
        changedFiles: ['src/a.ts'],
      });
    },
  };
  const reviewers = {
    assess: async () => {
      events.push('codex:assess');
      return plan;
    },
    reviewClaude: async ({ angle }) => {
      events.push(`claude:${angle}`);
      return { status: 'complete', findings: [], suggestions: [] };
    },
    reviewCodex: async ({ angle }) => {
      events.push(`codex:${angle}`);
      return { status: 'complete', findings: [], suggestions: [] };
    },
    synthesize: async () => {
      events.push('codex:synthesis');
      return synthesis;
    },
  };
  return {
    events,
    context,
    plan,
    synthesis,
    options: {
      trigger: TRIGGER,
      state,
      marker,
      github,
      workspace,
      reviewers,
      logger: { log: (record) => events.push({ log: record }) },
      ...overrides,
    },
  };
}

test('Codex assesses scope before two Codex and one Opus angle start in parallel', async () => {
  const reviews = new Map(ANGLE_SLUGS.map((angle) => [angle, deferred()]));
  const { events, options } = harness();
  options.reviewers.reviewCodex = ({ angle }) => {
    events.push(`codex:${angle}`);
    return reviews.get(angle).promise;
  };
  options.reviewers.reviewClaude = ({ angle }) => {
      events.push(`claude:${angle}`);
      return reviews.get(angle).promise;
  };

  const resultPromise = runTrigger(options);
  await delay(0);
  assert.deepEqual(events.filter((event) => typeof event === 'string').slice(0, 6), [
    'marker:working',
    'workspace:create',
    'codex:assess',
    'codex:security-and-abuse',
    'claude:system-blast-radius',
    'codex:feature-truth-and-adjacent-regressions',
  ]);
  assert.equal(events.includes('codex:synthesis'), false);
  for (const review of reviews.values()) {
    review.resolve({ status: 'complete', findings: [], suggestions: [] });
  }
  const result = await resultPromise;
  assert.equal(result.status, 'complete');
  assert.ok(events.indexOf('codex:synthesis') > events.indexOf('codex:feature-truth-and-adjacent-regressions'));
});

test('coordinator exports bounded stage timing', () => {
  assert.equal(coordinatorModule.ASSESSMENT_BUDGET_MS, 10 * 60_000);
  assert.equal(coordinatorModule.ANGLE_WAVE_BUDGET_MS, 10 * 60_000);
  assert.equal(coordinatorModule.SYNTHESIS_BUDGET_MS, 10 * 60_000);
  assert.equal(coordinatorModule.REVIEWER_INACTIVITY_TIMEOUT_MS, 5 * 60_000);
  assert.equal(coordinatorModule.HEARTBEAT_INTERVAL_MS, 60_000);
});

test('runTrigger validates the heartbeat interval before acquiring a lease', async () => {
  const { events, options } = harness({ heartbeatIntervalMs: 0 });
  await assert.rejects(runTrigger(options), /heartbeatIntervalMs/);
  assert.deepEqual(events, []);
});

test('long model stages heartbeat the fixed lease until completion', async () => {
  const reviews = new Map(ANGLE_SLUGS.map((angle) => [angle, deferred()]));
  const { events, options } = harness({ heartbeatIntervalMs: 5 });
  options.reviewers.reviewCodex = ({ angle }) => reviews.get(angle).promise;
  options.reviewers.reviewClaude = ({ angle }) => reviews.get(angle).promise;

  const resultPromise = runTrigger(options);
  await delay(18);
  const heartbeatsDuringReview = events.filter((event) => event === 'state:heartbeat').length;
  for (const review of reviews.values()) {
    review.resolve({ status: 'complete', findings: [], suggestions: [] });
  }
  const result = await resultPromise;
  assert.equal(result.status, 'complete');
  assert.ok(heartbeatsDuringReview >= 2);
  const heartbeatCount = events.filter((event) => event === 'state:heartbeat').length;
  await delay(12);
  assert.equal(events.filter((event) => event === 'state:heartbeat').length, heartbeatCount);
});

test('a rejected heartbeat aborts every angle and schedules safe recovery', async () => {
  const { events, options } = harness({ heartbeatIntervalMs: 5 });
  let abortedAngles = 0;
  options.state.acquire = async () => ({
    acquired: true,
    ownerId: 'owner-1',
    deadlineAt: Date.now() + 100,
  });
  options.state.heartbeat = async () => {
    events.push('state:heartbeat');
    throw new Error('lease heartbeat failed');
  };
  const waitForAbort = ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      abortedAngles += 1;
      reject(signal.reason);
    }, { once: true });
  });
  options.reviewers.reviewCodex = waitForAbort;
  options.reviewers.reviewClaude = waitForAbort;
  options.github.submit = async () => assert.fail('native review must not be submitted');

  const result = await runTrigger(options);
  assert.equal(result.status, 'retry-scheduled');
  assert.match(result.reason, /heartbeat failed/i);
  assert.equal(abortedAngles, 3);
  assert.ok(events.includes('state:failure:review'));
  assert.ok(events.some((event) => String(event).startsWith('marker:retry:')));
  assert.equal(events.at(-1), 'state:release');
});

test('a failed Opus angle gets exactly one Codex replacement for the same angle', async () => {
  const { events, options } = harness();
  let opusCalls = 0;
  const originalCodex = options.reviewers.reviewCodex;
  options.reviewers.reviewClaude = async ({ angle }) => {
    opusCalls += 1;
    events.push(`claude:${angle}:failed`);
    throw new Error('Opus unavailable');
  };
  options.reviewers.reviewCodex = async (request) => {
    if (request.replacementFor === 'claude') events.push(`codex:replacement:${request.angle}`);
    return originalCodex(request);
  };

  const result = await runTrigger(options);
  assert.equal(result.status, 'complete');
  assert.equal(opusCalls, 1);
  assert.ok(events.includes('codex:replacement:system-blast-radius'));
  assert.ok(events.includes('codex:synthesis'));
});

test('an exhausted Codex angle blocks synthesis and remains retryable', async () => {
  const { events, options } = harness();
  options.reviewers.reviewCodex = async ({ angle }) => {
    events.push(`codex:${angle}:failed`);
    if (angle === ANGLE_SLUGS[0]) throw new Error('Codex unavailable');
    return { status: 'complete', findings: [], suggestions: [] };
  };
  options.reviewers.synthesize = async () => assert.fail('synthesis must not start');

  const result = await runTrigger(options);
  assert.equal(result.status, 'retry-scheduled');
  assert.match(result.reason, /Codex unavailable/);
  assert.ok(events.includes('state:failure:review'));
});

test('whole-run deadline aborts outstanding reviewers and schedules recovery', async () => {
  const { events, options } = harness();
  options.state.acquire = async () => ({
    acquired: true,
    ownerId: 'owner-1',
    deadlineAt: Date.now() + 5,
  });
  options.reviewers.reviewCodex = async ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  options.reviewers.reviewClaude = options.reviewers.reviewCodex;

  const result = await runTrigger(options);
  assert.equal(result.status, 'retry-scheduled');
  assert.match(result.reason, /deadline/i);
  assert.ok(events.includes('state:failure:deadline'));
});

test('stale heads and required-check regressions perform no native review write', async () => {
  for (const recheck of [
    { headSha: 'f'.repeat(40), requiredChecksPass: true },
    { headSha: HEAD, requiredChecksPass: false, failedRequiredChecks: ['test'] },
  ]) {
    const { events, options } = harness();
    options.github.recheck = async () => recheck;
    options.github.submit = async () => assert.fail('native review must not be submitted');
    const result = await runTrigger(options);
    if (recheck.headSha !== HEAD) {
      assert.equal(result.status, 'stale');
      assert.ok(events.includes('marker:stale'));
    } else {
      assert.equal(result.status, 'retry-scheduled');
      assert.ok(events.includes('state:failure:required-checks'));
    }
  }
});

test('dry-run captures eligibility but performs no marker or reviewer write', async () => {
  const { events, options } = harness({ dryRun: true });
  options.reviewers.assess = async () => assert.fail('reviewer must not start');
  options.github.submit = async () => assert.fail('GitHub write must not happen');
  const result = await runTrigger(options);

  assert.equal(result.status, 'eligible');
  assert.equal(events.some((event) => String(event).startsWith('marker:')), false);
  assert.equal(events.at(-1), 'state:release');
});

test('a review workspace failure schedules retry without launching models', async () => {
  const { events, options } = harness();
  options.workspace.create = async () => {
    throw new Error('Review workspace head mismatch');
  };
  options.reviewers.assess = async () => assert.fail('Codex must not start');
  options.github.submit = async () => assert.fail('GitHub review must not be submitted');

  const result = await runTrigger(options);

  assert.equal(result.status, 'retry-scheduled');
  assert.ok(events.includes('state:failure:review'));
  assert.ok(events.some((event) => String(event).startsWith('marker:retry:')));
  assert.equal(events.at(-1), 'state:release');
});

test('completion binds state, marker, and submission to the exact trigger without logging packets', async () => {
  const { events, options } = harness();
  const result = await runTrigger(options);
  const serializedLogs = JSON.stringify(events.filter((event) => typeof event === 'object'));

  assert.equal(result.status, 'complete');
  assert.ok(events.includes(`github:submit:${TRIGGER.triggerId}`));
  assert.ok(events.includes(`marker:complete:${TRIGGER.triggerId}`));
  assert.ok(events.includes(`state:success:${TRIGGER.triggerId}`));
  assert.doesNotMatch(
    serializedLogs,
    /diff --git|brb-review|CLAUDE_SECRET|CODEX_SECRET/,
  );
});

test('runQueue processes pull requests sequentially', async () => {
  const events = [];
  const triggers = [
    { ...TRIGGER, number: 1 },
    { ...TRIGGER, number: 2, triggerId: 'review-requested:9' },
  ];
  const results = await runQueue({
    triggers,
    run: async (trigger) => {
      events.push(`start:${trigger.number}`);
      await delay(1);
      events.push(`end:${trigger.number}`);
      return { status: 'complete' };
    },
  });

  assert.deepEqual(events, ['start:1', 'end:1', 'start:2', 'end:2']);
  assert.deepEqual(results.map(({ status }) => status), ['complete', 'complete']);
});

test('coordinator CLI reports a no-work tick without invoking models or writes', async () => {
  const output = [];
  const calls = [];
  const args = [
    'run',
    '--repo', 'acme/widget',
    '--author', 'mrshu',
    '--reviewer', 'reviewer',
    '--repository', '/absolute/repository',
    '--state-dir', '/absolute/state',
    '--claude-model', 'sonnet',
    '--codex-model', 'gpt-5.6-sol',
  ];
  const result = await main(args, {
    execute: async (command, commandArgs) => {
      calls.push({ command, args: commandArgs });
      return { stdout: '[]', stderr: '' };
    },
    reviewers: {
      claude: async () => assert.fail('Claude must not run'),
      codex: async () => assert.fail('Codex must not run'),
    },
    write: (value) => output.push(value),
  });

  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(output.join('')), { status: 'no-work' });
});
