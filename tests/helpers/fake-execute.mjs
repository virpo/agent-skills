import assert from 'node:assert/strict';

export function fakeExecute(responses) {
  const calls = [];
  let index = 0;
  const execute = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    const response = responses[index++];
    assert.notEqual(response, undefined, `unexpected command: ${command} ${args.join(' ')}`);
    if (response instanceof Error) throw response;
    return response;
  };
  execute.calls = calls;
  return execute;
}
