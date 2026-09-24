import { openStore } from './store.mjs';
import { applyOperations, actionDecision, planReview } from './model.mjs';

const command = process.argv[2] ?? 'status';
if (command === 'help' || command === '--help') {
  console.log('Account review: status | snapshot | plan | apply | check-action CASE_ID\napply reads {expectedRevision,operations} JSON from stdin. No network or external actions are performed. Private state uses Windows account encryption.');
} else {
  let store;
  try {
    store = openStore();
    let result;
    if (command === 'apply') {
      let input = ''; for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Input too large'); }
      const request = JSON.parse(input);
      if (!Number.isSafeInteger(request.expectedRevision)) throw new Error('Read current revision before applying changes');
      result = store.update(request.expectedRevision, data => applyOperations(data, request.operations));
      result = { revision: result.revision, caseCount: Object.keys(result.data.cases).length, sourceCount: Object.keys(result.data.sources).length, externalActionsPerformed: 0 };
    } else {
      const state = store.read();
      if (command === 'snapshot') result = state;
      else if (command === 'plan') result = { revision: state.revision, ...planReview(state.data) };
      else if (command === 'check-action') result = actionDecision(state.data, process.argv[3]);
      else if (command === 'status') result = { revision: state.revision, cases: Object.keys(state.data.cases).length, sources: Object.values(state.data.sources), mode: state.data.policy.mode, paused: state.data.policy.paused, externalExecutionEnabled: false };
      else throw new Error('Unknown command; use help');
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(JSON.stringify({ status: 'failed', message: error.message })); process.exitCode = 1; }
  finally { store?.close(); }
}
