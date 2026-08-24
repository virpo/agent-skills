import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ANGLE_SLUGS,
  main,
  runQueue,
  runTrigger,
} from '../skills/blast-radius-buddy/scripts/review-coordinator.mjs';

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
    requiredChecksPass: true,
    packetSource: 'bounded packet SECRET_TOKEN',
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
  const reviewers = {
    claude: async ({ angle }) => {
      events.push(`claude:${angle}`);
      return { status: 'complete', findings: [], suggestions: [] };
    },
    codex: async () => {
      events.push('codex:synthesis');
      return synthesis;
    },
  };
  return {
    events,
    context,
    synthesis,
    options: {
      trigger: TRIGGER,
      state,
      marker,
      github,
      packetBuilder: async () => 'bounded packet SECRET_TOKEN',
      reviewers,
      logger: { log: (record) => events.push({ log: record }) },
      ...overrides,
    },
  };
}

test('three Claude angles start in parallel before one Codex synthesis', async () => {
  const reviews = new Map(ANGLE_SLUGS.map((angle) => [angle, deferred()]));
  const { events, options } = harness();
  options.reviewers = {
    claude: ({ angle }) => {
      events.push(`claude:${angle}`);
      return reviews.get(angle).promise;
    },
    codex: async () => {
      events.push('codex:synthesis');
      return harness().synthesis;
    },
  };

  const resultPromise = runTrigger(options);
  await delay(0);
  assert.deepEqual(events.filter((event) => typeof event === 'string').slice(0, 4), [
    'marker:working',
    'claude:security-and-abuse',
    'claude:system-blast-radius',
    'claude:feature-truth-and-adjacent-regressions',
  ]);
  assert.equal(events.includes('codex:synthesis'), false);
  for (const review of reviews.values()) {
    review.resolve({ status: 'complete', findings: [], suggestions: [] });
  }
  const result = await resultPromise;
  assert.equal(result.status, 'complete');
  assert.ok(events.indexOf('codex:synthesis') > events.indexOf('claude:feature-truth-and-adjacent-regressions'));
});

test('a failed Claude angle aborts siblings, skips Codex, and remains retryable', async () => {
  const { events, options } = harness();
  options.reviewers = {
    claude: async ({ angle, signal }) => {
      events.push(`claude:${angle}`);
      if (angle === ANGLE_SLUGS[0]) throw new Error('Claude model unavailable');
      await new Promise((_, reject) => signal.addEventListener(
        'abort',
        () => reject(signal.reason),
        { once: true },
      ));
    },
    codex: async () => assert.fail('Codex must not start'),
  };

  const result = await runTrigger(options);
  assert.equal(result.status, 'retry-scheduled');
  assert.match(result.reason, /Claude model unavailable/);
  assert.ok(events.some((event) => event === 'state:failure:review'));
  assert.ok(events.some((event) => String(event).startsWith('marker:retry:')));
  assert.equal(events.at(-1), 'state:release');
});

test('whole-run deadline aborts outstanding reviewers and schedules recovery', async () => {
  const { events, options } = harness();
  options.state.acquire = async () => ({
    acquired: true,
    ownerId: 'owner-1',
    deadlineAt: Date.now() + 5,
  });
  options.reviewers.claude = async ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

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
  options.reviewers.claude = async () => assert.fail('reviewer must not start');
  options.github.submit = async () => assert.fail('GitHub write must not happen');
  const result = await runTrigger(options);

  assert.equal(result.status, 'eligible');
  assert.equal(events.some((event) => String(event).startsWith('marker:')), false);
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
  assert.doesNotMatch(serializedLogs, /bounded packet|SECRET_TOKEN/);
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
