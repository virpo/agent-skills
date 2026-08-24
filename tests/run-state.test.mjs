import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acquireLease,
  heartbeatLease,
  nextEligibleAt,
  recordFailure,
  recordSuccess,
  releaseLease,
} from '../skills/blast-radius-buddy/scripts/run-state.mjs';

const MINUTE = 60_000;

async function withState(run) {
  const stateDir = await mkdtemp(join(tmpdir(), 'brb-run-state-test-'));
  try {
    await run(stateDir);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

test('lease acquisition is exclusive while its owner is alive', async () => withState(async (stateDir) => {
  const first = await acquireLease({
    stateDir,
    triggerKey: 'pr-466-head-a',
    now: 1_000,
    pid: 11,
    isProcessAlive: () => true,
  });
  const second = await acquireLease({
    stateDir,
    triggerKey: 'pr-466-head-a',
    now: 2_000,
    pid: 22,
    isProcessAlive: () => true,
  });

  assert.equal(first.acquired, true);
  assert.equal(first.deadlineAt, 1_000 + 30 * MINUTE);
  assert.deepEqual(second, { acquired: false, reason: 'owned', ownerId: first.ownerId });
}));

test('a dead owner or elapsed whole-run deadline is reclaimable', async () => {
  for (const { alive, now } of [
    { alive: false, now: 2_000 },
    { alive: true, now: 31 * MINUTE },
  ]) {
    await withState(async (stateDir) => {
      const first = await acquireLease({
        stateDir, triggerKey: 'pr-466-head-a', now: 1_000, pid: 11,
        isProcessAlive: () => true,
      });
      const second = await acquireLease({
        stateDir, triggerKey: 'pr-466-head-a', now, pid: 22,
        isProcessAlive: () => alive,
      });
      assert.equal(first.acquired, true);
      assert.equal(second.acquired, true);
      assert.notEqual(second.ownerId, first.ownerId);
      assert.equal(second.reclaimed, true);
    });
  }
});

test('heartbeats require the owner and preserve the whole-run deadline', async () => withState(async (stateDir) => {
  const lease = await acquireLease({
    stateDir, triggerKey: 'pr-466-head-a', now: 1_000, pid: 11,
    isProcessAlive: () => true,
  });
  await assert.rejects(
    heartbeatLease({
      stateDir, triggerKey: 'pr-466-head-a', ownerId: 'someone-else', now: 2_000,
    }),
    /owner mismatch/i,
  );
  const heartbeat = await heartbeatLease({
    stateDir, triggerKey: 'pr-466-head-a', ownerId: lease.ownerId, now: 5_000,
  });
  assert.equal(heartbeat.heartbeatAt, 5_000);
  assert.equal(heartbeat.deadlineAt, lease.deadlineAt);
}));

test('release refuses an owner mismatch and makes a trigger acquirable again', async () => withState(async (stateDir) => {
  const lease = await acquireLease({
    stateDir, triggerKey: 'pr-466-head-a', now: 1_000, pid: 11,
    isProcessAlive: () => true,
  });
  await assert.rejects(
    releaseLease({ stateDir, triggerKey: 'pr-466-head-a', ownerId: 'wrong' }),
    /owner mismatch/i,
  );
  assert.equal(await releaseLease({
    stateDir, triggerKey: 'pr-466-head-a', ownerId: lease.ownerId,
  }), true);
  assert.equal((await acquireLease({
    stateDir, triggerKey: 'pr-466-head-a', now: 2_000, pid: 22,
    isProcessAlive: () => true,
  })).acquired, true);
}));

test('failures back off for 5, 15, 30, then 60 minutes and cap there', async () => withState(async (stateDir) => {
  const expectedMinutes = [5, 15, 30, 60, 60];
  for (let index = 0; index < expectedMinutes.length; index += 1) {
    const now = index * 100_000;
    const failure = await recordFailure({
      stateDir,
      triggerKey: 'pr-466-head-a',
      category: 'model-unavailable',
      now,
    });
    assert.equal(failure.attemptCount, index + 1);
    assert.equal(failure.nextEligibleAt, now + expectedMinutes[index] * MINUTE);
    assert.equal(await nextEligibleAt({ stateDir, triggerKey: 'pr-466-head-a' }), failure.nextEligibleAt);
  }
}));

test('success resets retry state without affecting another trigger', async () => withState(async (stateDir) => {
  await recordFailure({ stateDir, triggerKey: 'pr-466-head-a', category: 'timeout', now: 0 });
  const other = await recordFailure({
    stateDir, triggerKey: 'pr-466-review-request-9', category: 'timeout', now: 10,
  });
  await recordSuccess({ stateDir, triggerKey: 'pr-466-head-a' });

  assert.equal(await nextEligibleAt({ stateDir, triggerKey: 'pr-466-head-a' }), null);
  assert.equal(
    await nextEligibleAt({ stateDir, triggerKey: 'pr-466-review-request-9' }),
    other.nextEligibleAt,
  );
  assert.equal((await recordFailure({
    stateDir, triggerKey: 'pr-466-head-a', category: 'timeout', now: 20,
  })).attemptCount, 1);
}));

test('unsafe inputs and malformed durable state fail closed', async () => withState(async (stateDir) => {
  await assert.rejects(
    acquireLease({
      stateDir: 'relative', triggerKey: 'safe', now: 0, pid: 1,
      isProcessAlive: () => true,
    }),
    /absolute/i,
  );
  for (const triggerKey of ['', '../escape', 'owner/repo', 'owner\\repo']) {
    await assert.rejects(
      acquireLease({ stateDir, triggerKey, now: 0, pid: 1, isProcessAlive: () => true }),
      /trigger key/i,
    );
  }

  await writeFile(join(stateDir, 'lease-malformed.json'), '{broken', 'utf8');
  await assert.rejects(
    acquireLease({
      stateDir, triggerKey: 'malformed', now: 0, pid: 1,
      isProcessAlive: () => false,
    }),
    /malformed state/i,
  );
  assert.equal(await readFile(join(stateDir, 'lease-malformed.json'), 'utf8'), '{broken');

  await writeFile(join(stateDir, 'retry-malformed.json'), '{}', 'utf8');
  await assert.rejects(
    nextEligibleAt({ stateDir, triggerKey: 'malformed' }),
    /malformed state/i,
  );
}));
