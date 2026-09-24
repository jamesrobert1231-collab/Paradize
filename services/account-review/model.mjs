import { createHash } from 'node:crypto';

const states = new Set(['new', 'prepared', 'awaiting_approval', 'authorized', 'executing', 'submitted', 'confirmed', 'blocked', 'dismissed']);
const priorities = new Set(['low', 'normal', 'high', 'urgent']);
const sourceStates = new Set(['readable', 'profile_accessible', 'reauthentication_required', 'unavailable', 'not_connected']);
const actionKinds = new Set(['draft', 'local_proposal', 'send_reply', 'request_refund', 'cancel_subscription', 'rsvp', 'shared_edit', 'publish', 'payment']);
const terminal = new Set(['confirmed', 'dismissed']);
const transitions = {
  new: ['prepared', 'awaiting_approval', 'blocked', 'dismissed', 'confirmed'],
  prepared: ['awaiting_approval', 'blocked', 'dismissed', 'confirmed'],
  awaiting_approval: ['blocked', 'dismissed', 'confirmed'],
  authorized: ['blocked', 'dismissed', 'confirmed'],
  executing: ['blocked', 'confirmed'],
  submitted: ['confirmed', 'blocked'],
  blocked: ['new', 'prepared', 'awaiting_approval', 'dismissed', 'confirmed'],
  confirmed: [], dismissed: [],
};

function requireValue(ok, message) { if (!ok) throw new Error(message); }
function string(value, name, limit = 4000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= limit, `Invalid ${name}`);
  return value;
}
function key(value) { requireValue(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,180}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), 'Invalid identifier'); return value; }
function time(value) { requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'ISO timestamp with timezone required'); return value; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function evidence(value) { string(value, 'evidence', 8000); return value; }
function audit(record, type, at, detail) {
  record.history ??= [];
  record.history.push({ type, at, detail });
  requireValue(record.history.length <= 500, 'Case history limit reached; preserve/export history before continuing');
}
function action(value) {
  requireValue(value && actionKinds.has(value.kind), 'Unsupported proposed action');
  string(value.target, 'action target', 2000); string(value.text, 'action text', 12000);
  requireValue(Object.keys(value).every(k => ['kind', 'target', 'text'].includes(k)), 'Unexpected action field');
  return structuredClone(value);
}

export function applyOperations(input, operations, now = new Date().toISOString()) {
  time(now);
  requireValue(Array.isArray(operations) && operations.length > 0 && operations.length <= 100, 'Expected 1-100 operations');
  const data = structuredClone(input);
  requireValue(data.version === 1 && data.sources && data.cases && data.notifications && data.policy, 'Unsupported review state');
  for (const op of operations) {
    requireValue(op && typeof op.type === 'string', 'Operation type required');
    if (op.type === 'source') {
      const id = key(op.key); const previous = data.sources[id] ?? {};
      requireValue(sourceStates.has(op.status), 'Invalid source status');
      time(op.checkedAt); requireValue(Date.parse(op.checkedAt) <= Date.parse(now) + 60000, 'Source observation is in the future');
      if (previous.checkedAt) requireValue(Date.parse(op.checkedAt) >= Date.parse(previous.checkedAt), 'Stale source observation');
      string(op.label, 'source label', 200); string(op.identity, 'source identity', 500); string(op.coverage, 'coverage', 3000);
      if (previous.identity) requireValue(op.identity === previous.identity, 'Account identity changed; register a new source key');
      const next = { ...previous, key: id, label: op.label, identity: op.identity, status: op.status, coverage: op.coverage, checkedAt: op.checkedAt, blocker: op.blocker ?? null };
      if (op.blocker !== undefined && op.blocker !== null) string(op.blocker, 'blocker', 2000);
      if (op.watchItems !== undefined) {
        requireValue(Array.isArray(op.watchItems) && op.watchItems.length <= 50, 'Too many watched items');
        next.watchItems = op.watchItems.map(item => string(item, 'watched source item', 500));
      }
      if (op.checkpoint !== undefined) {
        requireValue(op.status === 'readable' && op.complete === true, 'Advance checkpoint only after a complete successful bounded review');
        time(op.checkpoint); requireValue(Date.parse(op.checkpoint) <= Date.parse(op.checkedAt), 'Checkpoint exceeds observation time');
        if (previous.checkpoint) requireValue(Date.parse(op.checkpoint) >= Date.parse(previous.checkpoint), 'Checkpoint cannot move backwards');
        next.checkpoint = op.checkpoint; next.lastSuccessfulReviewAt = op.checkedAt;
      }
      data.sources[id] = next;
    } else if (op.type === 'observe') {
      const value = op.case; const id = key(value?.id); key(value.sourceKey);
      requireValue(data.sources[value.sourceKey], 'Register source before case');
      string(value.title, 'case title', 300); string(value.summary, 'case summary', 5000);
      requireValue(priorities.has(value.priority), 'Invalid priority');
      requireValue(Array.isArray(value.references) && value.references.length > 0 && value.references.length <= 20, 'Source references required');
      for (const ref of value.references) {
        string(ref.id, 'source item id', 500);
        if (ref.url) requireValue(/^https:\/\//.test(ref.url) && new URL(ref.url).protocol === 'https:' && !new URL(ref.url).username && !new URL(ref.url).password, 'Source URL must be HTTPS without credentials');
      }
      if (value.deadlineAt) time(value.deadlineAt);
      if (value.nextCheckAt) time(value.nextCheckAt);
      if (value.deadlineDate) {
        requireValue(/^\d{4}-\d\d-\d\d$/.test(value.deadlineDate) && new Date(value.deadlineDate).toISOString().slice(0, 10) === value.deadlineDate, 'Invalid date-only deadline');
        string(value.deadlineTimezone, 'deadline timezone', 100);
        new Intl.DateTimeFormat('en', { timeZone: value.deadlineTimezone });
        requireValue(!value.deadlineAt, 'Use a timestamp or date-only deadline, not both');
      }
      const observedAt = op.observedAt ? time(op.observedAt) : now;
      requireValue(Date.parse(observedAt) <= Date.parse(now) + 60000, 'Case observation is in the future');
      const proposedAction = value.proposedAction ? action(value.proposedAction) : null;
      const observation = { id, sourceKey: value.sourceKey, title: value.title, summary: value.summary, priority: value.priority, references: value.references, deadlineAt: value.deadlineAt ?? null, deadlineDate: value.deadlineDate ?? null, deadlineTimezone: value.deadlineDate ? value.deadlineTimezone : null, nextCheckAt: value.nextCheckAt ?? null, proposedAction };
      const hash = fingerprint(observation);
      const old = data.cases[id];
      if (old) requireValue(Date.parse(observedAt) >= Date.parse(old.observedAt), 'Stale case observation');
      if (old && old.sourceKey !== value.sourceKey) throw new Error('Case source identity cannot change');
      const record = { ...old, ...observation, observedAt, observationHash: hash, actionHash: proposedAction ? fingerprint(proposedAction) : null, state: old?.state ?? 'new' };
      if (!old) { record.createdAt = now; record.changedAt = now; audit(record, 'created', now, evidence(op.evidence)); }
      else if (old.observationHash !== hash) {
        record.changedAt = now; audit(record, 'observed_change', now, evidence(op.evidence));
        if (old.actionHash !== record.actionHash && old.approval) {
          record.approval = null;
          if (old.state === 'authorized') record.state = 'awaiting_approval';
          audit(record, 'approval_invalidated', now, 'Proposed action changed');
        }
      }
      // An observation never recreates a discarded draft or silently reopens a finished case.
      data.cases[id] = record;
    } else if (op.type === 'transition') {
      const record = data.cases[key(op.caseId)]; requireValue(record, 'Unknown case');
      requireValue(states.has(op.state) && transitions[record.state].includes(op.state), 'Invalid case transition');
      if (op.state === 'confirmed') requireValue(op.confirmation === 'source_receipt' || op.confirmation === 'user_report', 'Completion requires provider receipt or explicit user report');
      record.state = op.state; record.changedAt = now; record.approval = null;
      audit(record, op.state, now, evidence(op.evidence));
      if (op.state === 'confirmed') record.confirmation = { kind: op.confirmation, evidence: op.evidence, at: now };
    } else if (op.type === 'draft_status') {
      const record = data.cases[key(op.caseId)]; requireValue(record, 'Unknown case');
      requireValue(['unsent', 'sent', 'trashed', 'missing'].includes(op.status), 'Invalid draft status');
      const checkedAt = op.checkedAt ? time(op.checkedAt) : now;
      requireValue(Date.parse(checkedAt) <= Date.parse(now) + 60000, 'Draft observation is in the future');
      const old = record.draft;
      if (old) requireValue(Date.parse(checkedAt) >= Date.parse(old.checkedAt), 'Stale draft observation');
      record.draft = { id: string(op.id, 'draft id', 500), status: op.status, checkedAt };
      if (!old || old.id !== op.id || old.status !== op.status) {
        record.changedAt = now; audit(record, 'draft_status', now, evidence(op.evidence));
        if (op.status === 'trashed' || op.status === 'missing') {
          record.approval = null; record.hold = 'draft_removed'; record.holdAt = now;
          if (!terminal.has(record.state)) record.state = 'blocked';
        }
        if (op.status === 'sent') {
          record.approval = null;
          if (!terminal.has(record.state)) record.state = 'submitted';
        }
      }
    } else if (op.type === 'user_direction') {
      const record = data.cases[key(op.caseId)]; requireValue(record, 'Unknown case');
      requireValue(op.authority === 'direct_user', 'User direction must come from the conversation, never retrieved content');
      const messageAt = op.messageAt ? time(op.messageAt) : null;
      if (messageAt) requireValue(Date.parse(messageAt) <= Date.parse(now) + 60000, 'User direction is in the future');
      const entry = { messageRef: string(op.messageRef, 'user message reference', 500), quote: evidence(op.quote), at: messageAt, recordedAt: now };
      record.userDirections ??= [];
      if (record.userDirections.some(item => item.messageRef === entry.messageRef)) continue;
      if (op.releaseHold === true) requireValue(messageAt && record.holdAt && Date.parse(messageAt) > Date.parse(record.holdAt), 'A new user direction after the hold is required');
      record.userDirections.push(entry);
      if (op.releaseHold === true) { record.hold = null; record.holdAt = null; if (record.state === 'blocked') record.state = 'awaiting_approval'; }
      if (op.reopen === true && terminal.has(record.state)) record.state = 'new';
      record.changedAt = now; audit(record, 'user_direction', now, entry.quote);
    } else if (op.type === 'approve') {
      const record = data.cases[key(op.caseId)]; requireValue(record?.proposedAction, 'Proposed action required');
      requireValue(!terminal.has(record.state) && !['submitted', 'executing'].includes(record.state) && !record.hold, 'Case cannot be approved while finished, executing, submitted, or held');
      requireValue(op.actionHash === record.actionHash, 'Approval must match the exact current action');
      requireValue(op.authority === 'direct_user', 'Explicit user authority required');
      time(op.expiresAt); requireValue(Date.parse(op.expiresAt) > Date.parse(now) && Date.parse(op.expiresAt) <= Date.parse(now) + 7 * 86400000, 'Approval lifetime must be within seven days');
      record.approval = { actionHash: op.actionHash, expiresAt: op.expiresAt, messageRef: string(op.messageRef, 'approval message reference', 500), quote: evidence(op.quote), approvedAt: now };
      record.state = 'authorized'; record.changedAt = now; audit(record, 'authorized', now, op.quote);
    } else if (op.type === 'begin_action') {
      const record = data.cases[key(op.caseId)]; requireValue(record, 'Unknown case');
      const decision = actionDecision(data, op.caseId, now); requireValue(decision.allowed, decision.reason);
      requireValue(op.actionHash === record.actionHash, 'Action changed before dispatch');
      record.attempts ??= [];
      requireValue(!record.attempts.some(a => a.id === op.attemptId), 'Attempt identifier already used');
      requireValue(!record.attempts.some(a => a.outcome !== 'definitely_not_executed'), 'Reconcile all previous attempts before a new dispatch');
      record.attempts.push({ id: key(op.attemptId), actionHash: record.actionHash, startedAt: now, outcome: 'unknown' });
      record.state = 'executing'; record.changedAt = now; audit(record, 'dispatch_reserved', now, 'Dispatch reserved; this is not evidence that an external action happened');
    } else if (op.type === 'action_result') {
      const record = data.cases[key(op.caseId)]; requireValue(record, 'Unknown case');
      const attempt = record.attempts?.find(a => a.id === op.attemptId); requireValue(attempt && attempt.outcome === 'unknown', 'Unknown or already settled attempt');
      requireValue(['submitted', 'verified', 'definitely_not_executed', 'unknown'].includes(op.outcome), 'Invalid action outcome');
      attempt.outcome = op.outcome; attempt.evidence = evidence(op.evidence); attempt.checkedAt = now;
      record.state = op.outcome === 'verified' ? 'confirmed' : op.outcome === 'submitted' ? 'submitted' : 'blocked';
      record.changedAt = now; record.approval = null;
      if (op.outcome === 'verified') record.confirmation = { kind: 'source_receipt', evidence: op.evidence, at: now };
      audit(record, 'action_result', now, op.evidence);
    } else if (op.type === 'pause') {
      requireValue(typeof op.paused === 'boolean', 'Pause state required');
      data.policy.paused = op.paused;
    } else if (op.type === 'reported') {
      requireValue(Array.isArray(op.keys) && op.keys.length <= 100, 'Report keys required');
      const available = new Map(planReview(data, now).notifications.map(n => [n.key, n.fingerprint]));
      for (const item of op.keys) {
        const notification = typeof item?.key === 'string' && /^(source|case):(.+)$/.exec(item.key);
        requireValue(notification, 'Invalid notification identifier');
        key(notification[2]);
        requireValue(typeof item.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(item.fingerprint) && available.has(item.key) && available.get(item.key) === item.fingerprint, 'Report no longer matches current state');
        data.notifications[item.key] = { fingerprint: item.fingerprint, reportedAt: now, deliveryVerified: false };
      }
    } else throw new Error('Unknown operation');
  }
  requireValue(Object.keys(data.cases).length <= 1000 && Object.keys(data.sources).length <= 100, 'Review store record limit');
  return data;
}

export function actionDecision(data, caseId, now = new Date().toISOString()) {
  const record = data.cases[caseId]; const reject = reason => ({ allowed: false, reason });
  if (data.policy.paused) return reject('Monitor paused');
  if (!record?.proposedAction) return reject('No prepared action');
  if (record.draft?.status === 'sent') return reject('Tracked draft has already been sent; reconcile the outcome');
  if (record.attempts?.some(a => a.outcome !== 'definitely_not_executed')) return reject('Reconcile the previous attempt before dispatch');
  if (record.hold || record.state !== 'authorized') return reject('Exact action approval is required or case is held');
  if (!record.approval || record.approval.actionHash !== record.actionHash || Date.parse(record.approval.expiresAt) <= Date.parse(now)) return reject('Approval is missing, changed, or expired');
  const source = data.sources[record.sourceKey];
  if (source.status !== 'readable' || Date.parse(now) - Date.parse(source.checkedAt) > 15 * 60000) return reject('Refresh source access and current item before dispatch');
  if (Date.parse(now) - Date.parse(record.observedAt) > 15 * 60000) return reject('Refresh the current item before dispatch');
  return { allowed: true, reason: 'Exact action approved; external tool and provider permissions still apply', actionHash: record.actionHash };
}

export function planReview(data, now = new Date().toISOString()) {
  time(now); const stamp = Date.parse(now); const notifications = [];
  const add = (key, kind, value) => {
    const hash = fingerprint(value);
    if (data.notifications[key]?.fingerprint !== hash) notifications.push({ key, kind, fingerprint: hash, ...value });
  };
  for (const source of Object.values(data.sources)) {
    const stale = source.status !== 'not_connected' && stamp - Date.parse(source.checkedAt) > 26 * 3600000;
    add(`source:${source.key}`, 'coverage', { sourceKey: source.key, status: source.status, blocker: source.blocker, stale });
  }
  const cases = Object.values(data.cases).map(record => {
    const deadline = record.deadlineAt ? Date.parse(record.deadlineAt) : null;
    let deadlineStage = deadline === null ? null : stamp >= deadline ? 'overdue' : deadline - stamp <= 24 * 3600000 ? 'within_24_hours' : 'upcoming';
    if (record.deadlineDate) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: record.deadlineTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
      const today = `${parts.year}-${parts.month}-${parts.day}`;
      deadlineStage = record.deadlineDate < today ? 'overdue' : record.deadlineDate === today ? 'due_today' : 'upcoming';
    }
    const followUpDue = !!record.nextCheckAt && Date.parse(record.nextCheckAt) <= stamp;
    if (!terminal.has(record.state)) add(`case:${record.id}`, 'action', { caseId: record.id, state: record.state, observationHash: record.observationHash, priority: record.priority, deadlineStage, draftStatus: record.draft?.status ?? null, hold: record.hold ?? null, followUpDue });
    else if (record.state === 'confirmed') add(`case:${record.id}`, 'completion', { caseId: record.id, state: record.state, confirmation: record.confirmation });
    return { ...record, deadlineStage, followUpDue };
  }).sort((a, b) => ['urgent', 'high', 'normal', 'low'].indexOf(a.priority) - ['urgent', 'high', 'normal', 'low'].indexOf(b.priority));
  return { paused: data.policy.paused, notifications: data.policy.paused ? [] : notifications, cases, sources: Object.values(data.sources), deliveryVerified: false, executionEnabled: false };
}
