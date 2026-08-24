import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findEligibleTriggers,
  parseCompletionMetadata,
  selectTrigger,
} from '../skills/blast-radius-buddy/scripts/github-watch.mjs';
import { fakeExecute } from './helpers/fake-execute.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);

function result(value) {
  return { stdout: JSON.stringify(value) };
}

function completion({
  headSha = HEAD,
  triggerId,
  state = 'APPROVED',
  submittedAt = '2026-08-24T10:00:00Z',
} = {}) {
  const metadata = { headSha, findings: [], suggestions: [] };
  if (triggerId !== undefined) metadata.triggerId = triggerId;
  return {
    state,
    submitted_at: submittedAt,
    body: `Done\n\n<!-- blast-radius-buddy-review:${JSON.stringify(metadata)} -->`,
  };
}

function request({
  id = 9001,
  reviewer = 'reviewer',
  createdAt = '2026-08-24T10:05:00Z',
} = {}) {
  return {
    event: 'review_requested',
    id,
    created_at: createdAt,
    requested_reviewer: { login: reviewer },
  };
}

test('parseCompletionMetadata accepts current and legacy metadata and ignores malformed input', () => {
  assert.deepEqual(
    parseCompletionMetadata(completion({ triggerId: `head:${HEAD}` }).body),
    { headSha: HEAD, triggerId: `head:${HEAD}` },
  );
  assert.deepEqual(
    parseCompletionMetadata(completion().body),
    { headSha: HEAD, triggerId: null },
  );
  assert.equal(parseCompletionMetadata('<!-- blast-radius-buddy-review:not-json -->'), null);
  assert.equal(parseCompletionMetadata('ordinary review'), null);
});

test('selectTrigger chooses an incomplete head before considering review requests', () => {
  assert.deepEqual(
    selectTrigger({ headSha: HEAD, reviews: [], timeline: [request()], reviewer: 'reviewer' }),
    { triggerId: `head:${HEAD}`, triggerKind: 'head' },
  );
});

test('selectTrigger chooses the latest matching same-head re-review request after completion', () => {
  assert.deepEqual(
    selectTrigger({
      headSha: HEAD,
      reviews: [completion()],
      timeline: [
        request({ id: 9000, createdAt: '2026-08-24T09:00:00Z' }),
        request({ id: 9002, createdAt: '2026-08-24T10:06:00Z' }),
        request({ id: 9001, createdAt: '2026-08-24T10:05:00Z' }),
        request({ id: 9999, reviewer: 'someone-else', createdAt: '2026-08-24T10:07:00Z' }),
      ],
      reviewer: 'reviewer',
    }),
    { triggerId: 'review-requested:9002', triggerKind: 'review-requested' },
  );
});

test('selectTrigger suppresses completed triggers and ignores dismissed or stale reviews', () => {
  assert.equal(
    selectTrigger({
      headSha: HEAD,
      reviews: [completion({ triggerId: 'review-requested:9002' })],
      timeline: [request({ id: 9002, createdAt: '2026-08-24T09:59:00Z' })],
      reviewer: 'reviewer',
    }),
    null,
  );
  assert.deepEqual(
    selectTrigger({
      headSha: HEAD,
      reviews: [
        completion({ headSha: OLD_HEAD }),
        completion({ state: 'DISMISSED' }),
      ],
      timeline: [],
      reviewer: 'reviewer',
    }),
    { triggerId: `head:${HEAD}`, triggerKind: 'head' },
  );
});

test('findEligibleTriggers filters exact author, drafts, and required checks then sorts', async () => {
  const execute = fakeExecute([
    result([
      { number: 9, url: 'https://github.com/acme/widget/pull/9', isDraft: false, headRefOid: HEAD, author: { login: 'contributor' } },
      { number: 2, url: 'https://github.com/acme/widget/pull/2', isDraft: false, headRefOid: HEAD, author: { login: 'contributor' } },
      { number: 3, url: 'https://github.com/acme/widget/pull/3', isDraft: true, headRefOid: HEAD, author: { login: 'contributor' } },
      { number: 4, url: 'https://github.com/acme/widget/pull/4', isDraft: false, headRefOid: HEAD, author: { login: 'Contributor' } },
    ]),
    result([{ name: 'gate', bucket: 'pending', state: 'IN_PROGRESS' }]),
    result([]),
    result([]),
    result([]),
    result([]),
  ]);

  const triggers = await findEligibleTriggers({
    repo: 'acme/widget',
    author: 'contributor',
    reviewer: 'reviewer',
    execute,
  });

  assert.deepEqual(triggers, [{
    repo: 'acme/widget',
    number: 2,
    url: 'https://github.com/acme/widget/pull/2',
    headSha: HEAD,
    triggerId: `head:${HEAD}`,
    triggerKind: 'head',
  }]);
  assert.equal(execute.calls.some(({ args }) => args.includes('--method')), false);
  assert.equal(execute.calls.some(({ args }) => args.includes('POST')), false);
  assert.equal(execute.calls.some(({ args }) => args.includes('PATCH')), false);
});

test('findEligibleTriggers emits a same-head request only after a completed current review', async () => {
  const execute = fakeExecute([
    result([{ number: 42, url: 'https://github.com/acme/widget/pull/42', isDraft: false, headRefOid: HEAD, author: { login: 'contributor' } }]),
    result([{ name: 'gate', bucket: 'pass', state: 'SUCCESS' }]),
    result([completion()]),
    result([request()]),
  ]);

  assert.deepEqual(
    await findEligibleTriggers({ repo: 'acme/widget', author: 'contributor', reviewer: 'reviewer', execute }),
    [{
      repo: 'acme/widget',
      number: 42,
      url: 'https://github.com/acme/widget/pull/42',
      headSha: HEAD,
      triggerId: 'review-requested:9001',
      triggerKind: 'review-requested',
    }],
  );
});

test('findEligibleTriggers validates private deployment inputs before GitHub', async () => {
  const execute = fakeExecute([]);
  await assert.rejects(
    findEligibleTriggers({ repo: 'bad repo', author: 'user', reviewer: 'reviewer', execute }),
    /repo must use OWNER\/REPO format/,
  );
  await assert.rejects(
    findEligibleTriggers({ repo: 'acme/widget', author: 'bad user', reviewer: 'reviewer', execute }),
    /author must be a GitHub login/,
  );
  assert.equal(execute.calls.length, 0);
});
