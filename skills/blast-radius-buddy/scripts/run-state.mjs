import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const DEFAULT_DEADLINE_MS = 45 * 60_000;
const BACKOFF_MS = [5, 15, 30, 60].map((minutes) => minutes * 60_000);
const LEASE_FIELDS = [
  'triggerKey', 'pid', 'ownerId', 'startedAt', 'deadlineAt', 'heartbeatAt',
];
const RETRY_FIELDS = [
  'triggerKey', 'attemptCount', 'failureCategory', 'nextEligibleAt',
];

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateStateDir(stateDir) {
  if (typeof stateDir !== 'string' || !isAbsolute(stateDir)) {
    throw new TypeError('state directory must be an absolute path');
  }
  return stateDir;
}

function validateTriggerKey(triggerKey) {
  if (typeof triggerKey !== 'string'
    || triggerKey.length === 0
    || triggerKey.includes('/')
    || triggerKey.includes('\\')
    || /[\u0000-\u001f\u007f-\u009f]/.test(triggerKey)) {
    throw new TypeError('trigger key must be non-empty and contain no path separators');
  }
  return triggerKey;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer timestamp`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function exactFields(value, fields) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length
    && fields.every((field) => Object.hasOwn(value, field))
    && keys.every((field) => fields.includes(field));
}

function leasePath(stateDir, triggerKey) {
  return join(stateDir, `lease-${triggerKey}.json`);
}

function retryPath(stateDir, triggerKey) {
  return join(stateDir, `retry-${triggerKey}.json`);
}

function validateLease(value, triggerKey) {
  if (!exactFields(value, LEASE_FIELDS)
    || value.triggerKey !== triggerKey
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.ownerId !== 'string'
    || value.ownerId.length === 0
    || !Number.isSafeInteger(value.startedAt)
    || value.startedAt < 0
    || !Number.isSafeInteger(value.deadlineAt)
    || value.deadlineAt <= value.startedAt
    || !Number.isSafeInteger(value.heartbeatAt)
    || value.heartbeatAt < value.startedAt
    || value.heartbeatAt > value.deadlineAt) {
    throw new Error(`Refusing malformed state for trigger ${triggerKey}`);
  }
  return value;
}

function validateRetry(value, triggerKey) {
  if (!exactFields(value, RETRY_FIELDS)
    || value.triggerKey !== triggerKey
    || !Number.isSafeInteger(value.attemptCount)
    || value.attemptCount <= 0
    || typeof value.failureCategory !== 'string'
    || value.failureCategory.trim().length === 0
    || !Number.isSafeInteger(value.nextEligibleAt)
    || value.nextEligibleAt < 0) {
    throw new Error(`Refusing malformed state for trigger ${triggerKey}`);
  }
  return value;
}

async function readJsonState(path, triggerKey, validate) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Refusing malformed state for trigger ${triggerKey}`);
  }
  return validate(value, triggerKey);
}

async function atomicReplace(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
}

async function createLease(path, lease) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(lease)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function defaultProcessLiveness(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function validateIdentity({ stateDir, triggerKey }) {
  return {
    stateDir: validateStateDir(stateDir),
    triggerKey: validateTriggerKey(triggerKey),
  };
}

export async function acquireLease({
  stateDir,
  triggerKey,
  pid = process.pid,
  now = Date.now(),
  deadlineMs = DEFAULT_DEADLINE_MS,
  isProcessAlive = defaultProcessLiveness,
}) {
  ({ stateDir, triggerKey } = validateIdentity({ stateDir, triggerKey }));
  positiveInteger(pid, 'pid');
  timestamp(now, 'now');
  positiveInteger(deadlineMs, 'deadlineMs');
  if (typeof isProcessAlive !== 'function') {
    throw new TypeError('isProcessAlive must be a function');
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const retry = await readJsonState(retryPath(stateDir, triggerKey), triggerKey, validateRetry);
  if (retry && retry.nextEligibleAt > now) {
    return { acquired: false, reason: 'backoff', nextEligibleAt: retry.nextEligibleAt };
  }

  const path = leasePath(stateDir, triggerKey);
  let reclaimed = false;
  for (;;) {
    const ownerId = `${pid}:${now}:${randomUUID()}`;
    const lease = {
      triggerKey,
      pid,
      ownerId,
      startedAt: now,
      deadlineAt: now + deadlineMs,
      heartbeatAt: now,
    };
    try {
      await createLease(path, lease);
      return { acquired: true, ...lease, ...(reclaimed ? { reclaimed: true } : {}) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    const existing = await readJsonState(path, triggerKey, validateLease);
    if (existing === null) continue;
    const alive = await isProcessAlive(existing.pid);
    if (alive && now < existing.deadlineAt) {
      return { acquired: false, reason: 'owned', ownerId: existing.ownerId };
    }
    await unlink(path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    reclaimed = true;
  }
}

export async function heartbeatLease({ stateDir, triggerKey, ownerId, now = Date.now() }) {
  ({ stateDir, triggerKey } = validateIdentity({ stateDir, triggerKey }));
  timestamp(now, 'now');
  const path = leasePath(stateDir, triggerKey);
  const lease = await readJsonState(path, triggerKey, validateLease);
  if (lease === null) throw new Error('Lease does not exist');
  if (lease.ownerId !== ownerId) throw new Error('Lease owner mismatch');
  if (now > lease.deadlineAt) throw new Error('Lease deadline has elapsed');
  const updated = { ...lease, heartbeatAt: now };
  await atomicReplace(path, updated);
  return updated;
}

export async function releaseLease({ stateDir, triggerKey, ownerId }) {
  ({ stateDir, triggerKey } = validateIdentity({ stateDir, triggerKey }));
  const path = leasePath(stateDir, triggerKey);
  const lease = await readJsonState(path, triggerKey, validateLease);
  if (lease === null) return false;
  if (lease.ownerId !== ownerId) throw new Error('Lease owner mismatch');
  await unlink(path);
  return true;
}

export async function recordFailure({
  stateDir,
  triggerKey,
  category,
  now = Date.now(),
}) {
  ({ stateDir, triggerKey } = validateIdentity({ stateDir, triggerKey }));
  timestamp(now, 'now');
  if (typeof category !== 'string' || category.trim().length === 0) {
    throw new TypeError('failure category must be a non-empty string');
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = retryPath(stateDir, triggerKey);
  const previous = await readJsonState(path, triggerKey, validateRetry);
  const attemptCount = (previous?.attemptCount ?? 0) + 1;
  const delay = BACKOFF_MS[Math.min(attemptCount - 1, BACKOFF_MS.length - 1)];
  const retry = {
    triggerKey,
    attemptCount,
    failureCategory: category,
    nextEligibleAt: now + delay,
  };
  await atomicReplace(path, retry);
  return retry;
}

export async function recordSuccess({ stateDir, triggerKey }) {
  ({ stateDir, triggerKey } = validateIdentity({ stateDir, triggerKey }));
  await unlink(retryPath(stateDir, triggerKey)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function nextEligibleAt({ stateDir, triggerKey }) {
  ({ stateDir, triggerKey } = validateIdentity({ stateDir, triggerKey }));
  const retry = await readJsonState(retryPath(stateDir, triggerKey), triggerKey, validateRetry);
  return retry?.nextEligibleAt ?? null;
}
