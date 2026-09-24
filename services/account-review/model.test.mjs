import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, actionDecision, planReview } from './model.mjs';

const now = '2026-09-23T15:00:00Z';
const initial = () => ({ version: 1, sources: {}, cases: {}, notifications: {}, policy: { mode: 'prepare', paused: false, standingPermissions: [] } });
const source = { type: 'source', key: 'gmail:test', label: 'Gmail', identity: 'test@example.test', status: 'readable', checkedAt: now, coverage: 'Synthetic single thread', complete: true, checkpoint: now };
const observation = { type: 'observe', evidence: 'Synthetic provider observation', case: { id: 'test-case', sourceKey: 'gmail:test', title: 'Reply needed', summary: 'A synthetic request needs a reply', priority: 'high', references: [{ id: 'thread-1', url: 'https://example.test/thread-1' }], deadlineAt: '2026-09-24T15:00:00Z', proposedAction: { kind: 'send_reply', target: 'sender@example.test', text: 'Here is the requested information.' } } };
const fixture = () => applyOperations(initial(), [source, observation], now);
const approve = data => applyOperations(data, [{ type: 'approve', caseId: 'test-case', actionHash: data.cases['test-case'].actionHash, authority: 'direct_user', quote: 'Send this exact reply.', messageRef: 'user:test-approval', expiresAt: '2026-09-23T16:00:00Z' }], now);

test('failed source retains successful checkpoint and independent sources continue', () => {
  const result = applyOperations(fixture(), [{ ...source, status: 'reauthentication_required', checkpoint: undefined, checkedAt: '2026-09-23T15:01:00Z', blocker: 'expired' }, { ...source, key: 'outlook:test', checkedAt: '2026-09-23T15:01:00Z' }], '2026-09-23T15:01:00Z');
  assert.equal(result.sources['gmail:test'].checkpoint, now);
  assert.equal(result.sources['outlook:test'].status, 'readable');
  assert.throws(() => applyOperations(result, [{ ...source, status: 'reauthentication_required' }], now));
});
test('duplicate observations preserve case identity and generate no repeat notice', () => {
  let data = fixture(); const notices = planReview(data, now).notifications;
  data = applyOperations(data, [{ type: 'reported', keys: notices }], now);
  data = applyOperations(data, [observation], '2026-09-23T15:01:00Z');
  assert.equal(Object.keys(data.cases).length, 1);
  assert.equal(data.cases['test-case'].history.length, 1);
  assert.deepEqual(planReview(data, '2026-09-23T15:01:00Z').notifications, []);
});
test('deadline crossing produces one escalation and acknowledgments do not certify delivery', () => {
  let data = fixture(); data = applyOperations(data, [{ type: 'reported', keys: planReview(data, now).notifications }], now);
  const notices = planReview(data, '2026-09-24T15:00:01Z').notifications;
  assert.equal(notices.find(n => n.caseId === 'test-case').deadlineStage, 'overdue');
  assert.equal(data.notifications['case:test-case'].deliveryVerified, false);
});

test('maximum-length source and case identifiers can acknowledge their notifications', () => {
  const sourceKey = 's'.repeat(181), caseId = 'c'.repeat(181);
  const item = structuredClone(observation);
  item.case.id = caseId; item.case.sourceKey = sourceKey;
  const data = applyOperations(initial(), [{ ...source, key: sourceKey }, item], now);
  const notices = planReview(data, now).notifications;
  assert.deepEqual(notices.map(n => n.key).sort(), [`case:${caseId}`, `source:${sourceKey}`]);
  const reported = applyOperations(data, [{ type: 'reported', keys: notices }], now);
  assert.deepEqual(planReview(reported, now).notifications, []);
  for (const notice of notices) assert.equal(reported.notifications[notice.key].deliveryVerified, false);
});

test('notification acknowledgments reject invalid prefixes and overlong underlying identifiers', () => {
  const data = fixture(), fingerprint = planReview(data, now).notifications[0].fingerprint;
  for (const id of ['other:gmail:test', 'source:', 'case:', `source:${'s'.repeat(182)}`, `case:${'c'.repeat(182)}`]) {
    assert.throws(() => applyOperations(data, [{ type: 'reported', keys: [{ key: id, fingerprint }] }], now));
  }
  assert.deepEqual(data.notifications, {});
});
test('discarded draft revokes approval, blocks recreation, and persists across observations', () => {
  let data = approve(fixture());
  data = applyOperations(data, [{ type: 'draft_status', caseId: 'test-case', id: 'draft-1', status: 'trashed', evidence: 'Provider DRAFT/TRASH labels' }, observation], now);
  assert.equal(data.cases['test-case'].state, 'blocked');
  assert.equal(data.cases['test-case'].hold, 'draft_removed');
  assert.equal(actionDecision(data, 'test-case', now).allowed, false);
  assert.throws(() => approve(data));
});
test('exact approval is invalidated when recipient or body changes', () => {
  let data = approve(fixture()); assert.equal(actionDecision(data, 'test-case', now).allowed, true);
  const changed = structuredClone(observation); changed.case.proposedAction.target = 'different@example.test';
  data = applyOperations(data, [changed], now);
  assert.equal(data.cases['test-case'].state, 'awaiting_approval');
  assert.equal(actionDecision(data, 'test-case', now).allowed, false);
});
test('pause, stale source, stale item and expiry prevent dispatch', () => {
  let data = approve(fixture());
  assert.equal(actionDecision(data, 'test-case', '2026-09-23T15:16:00Z').allowed, false);
  assert.equal(actionDecision(data, 'test-case', '2026-09-23T16:00:00Z').allowed, false);
  data = applyOperations(data, [{ type: 'pause', paused: true }], now);
  assert.equal(actionDecision(data, 'test-case', now).allowed, false);
  assert.deepEqual(planReview(data, now).notifications, []);
});
test('uncertain action reserves dispatch and cannot be blindly sent again', () => {
  let data = approve(fixture());
  const reserve = { type: 'begin_action', caseId: 'test-case', attemptId: 'attempt-1', actionHash: data.cases['test-case'].actionHash };
  data = applyOperations(data, [reserve], now);
  assert.equal(data.cases['test-case'].state, 'executing');
  assert.equal(data.cases['test-case'].attempts[0].outcome, 'unknown');
  assert.throws(() => applyOperations(data, [reserve], now));
  assert.throws(() => approve(data));
});
test('completion requires explicit outcome evidence; a new observation cannot reopen it', () => {
  let data = fixture();
  assert.throws(() => applyOperations(data, [{ type: 'transition', caseId: 'test-case', state: 'confirmed', evidence: 'Draft exists' }], now));
  data = applyOperations(data, [{ type: 'transition', caseId: 'test-case', state: 'confirmed', confirmation: 'user_report', evidence: 'User says resolved in provider portal' }, observation], now);
  assert.equal(data.cases['test-case'].state, 'confirmed');
});
test('untrusted observations cannot set permissions, and incomplete reviews cannot advance', () => {
  const injected = structuredClone(observation); injected.case.state = 'authorized'; injected.case.approval = { actionHash: 'anything' };
  const data = applyOperations(initial(), [source, injected], now);
  assert.equal(data.cases['test-case'].state, 'new'); assert.equal(data.cases['test-case'].approval, undefined);
  assert.throws(() => applyOperations(data, [{ ...source, complete: false }], now));
});
test('date-only deadlines respect the named timezone without inventing a cutoff hour', () => {
  const item = structuredClone(observation); delete item.case.deadlineAt;
  item.case.deadlineDate = '2026-09-23'; item.case.deadlineTimezone = 'America/New_York';
  const data = applyOperations(initial(), [source, item], now);
  assert.equal(planReview(data, '2026-09-24T03:59:00Z').cases[0].deadlineStage, 'due_today');
  assert.equal(planReview(data, '2026-09-24T04:01:00Z').cases[0].deadlineStage, 'overdue');
});
test('historical seed observations cannot claim fresh account evidence', () => {
  const data = applyOperations(initial(), [source, { ...observation, observedAt: '2026-09-22T12:00:00Z' }], now);
  assert.equal(data.cases['test-case'].observedAt, '2026-09-22T12:00:00Z');
  assert.throws(() => applyOperations(data, [{ ...observation, observedAt: '2026-09-21T12:00:00Z' }], now));
  assert.throws(() => applyOperations(initial(), [{ ...source, key: 'constructor' }], now));
});
test('an account switch cannot retain another account approval or checkpoint', () => {
  const data = approve(fixture());
  assert.throws(() => applyOperations(data, [{ ...source, identity: 'different@example.test' }], now), /identity changed/);
});
test('a previously recorded user direction cannot release a later discarded-draft hold', () => {
  const direction = { type: 'user_direction', caseId: 'test-case', authority: 'direct_user', messageRef: 'user:old', messageAt: '2026-09-23T14:00:00Z', quote: 'Please send this' };
  let data = applyOperations(fixture(), [direction, { type: 'draft_status', caseId: 'test-case', id: 'draft-1', status: 'trashed', evidence: 'Provider Trash label' }], now);
  data = applyOperations(data, [{ ...direction, releaseHold: true }], now);
  assert.equal(data.cases['test-case'].hold, 'draft_removed');
  assert.throws(() => applyOperations(data, [{ ...direction, messageRef: 'user:other-old', releaseHold: true }], now), /after the hold/);
  data = applyOperations(data, [{ ...direction, messageRef: 'user:new', messageAt: '2026-09-23T15:01:00Z', releaseHold: true }], '2026-09-23T15:01:00Z');
  assert.equal(data.cases['test-case'].hold, null);
});
test('different wording cannot bypass an uncertain prior dispatch', () => {
  let data = approve(fixture());
  data = applyOperations(data, [{ type: 'begin_action', caseId: 'test-case', attemptId: 'uncertain', actionHash: data.cases['test-case'].actionHash }, { type: 'action_result', caseId: 'test-case', attemptId: 'uncertain', outcome: 'unknown', evidence: 'Timeout without authoritative receipt' }], now);
  const changed = structuredClone(observation); changed.case.proposedAction.text += ' Thank you.';
  data = approve(applyOperations(data, [changed], now));
  assert.equal(actionDecision(data, 'test-case', now).allowed, false);
  assert.throws(() => applyOperations(data, [{ type: 'begin_action', caseId: 'test-case', attemptId: 'duplicate', actionHash: data.cases['test-case'].actionHash }], now));
});
test('provider evidence that a draft was sent revokes dispatch without claiming fulfillment', () => {
  let data = approve(fixture());
  data = applyOperations(data, [{ type: 'draft_status', caseId: 'test-case', id: 'draft-1', status: 'sent', evidence: 'Provider SENT label' }], now);
  assert.equal(data.cases['test-case'].state, 'submitted');
  assert.equal(data.cases['test-case'].approval, null);
  assert.equal(actionDecision(data, 'test-case', now).allowed, false);
});
test('missing fingerprints and prototype keys cannot acknowledge a notification', () => {
  for (const item of [{ key: '__proto__' }, { key: 'case:test-case' }, { key: 'made-up', fingerprint: 'a'.repeat(64) }]) {
    assert.throws(() => applyOperations(fixture(), [{ type: 'reported', keys: [item] }], now));
  }
});
