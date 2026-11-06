// Run with: npm test
// The runner's argv is a constant: no prompt, path or report text ever rides on
// the command line, and a .cmd install gets every argument quoted for cmd.exe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { agentArgs, AGENT_MODEL, describeEvent, probeArgs, quoteForCmd, spawnSpec } from './claude.ts';

test('agent argv is fixed, confined and carries no user data', () => {
    const args = agentArgs();
    assert.deepEqual(args, agentArgs(), 'the same every call');
    assert.equal(args[args.indexOf('--model') + 1], AGENT_MODEL);
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Bash');
    for (const rule of ['Read(./**)', 'Edit(./**)', 'Bash(node tools/check-edit.mjs:*)']) assert.ok(args.includes(rule), rule);
    for (const rule of ['Read(**/.env*)', 'Read(../**)', 'Edit(../**)']) {
        assert.ok(args.indexOf(rule) > args.indexOf('--disallowedTools'), `${rule} is denied`);
    }
    // The whole argv, literally: no prompt, path or report text can be in it
    assert.deepEqual(args, [
        '-p', '--model', 'claude-opus-5-5', '--output-format', 'stream-json', '--verbose',
        '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence',
        '--permission-mode', 'dontAsk', '--tools', 'Read,Write,Bash',
        '--allowedTools', 'Read(./**)', 'Edit(./**)', 'Bash(node tools/check-edit.mjs:*)',
        '--disallowedTools', 'Read(**/.env*)', 'Read(../**)', 'Edit(../**)'
    ]);
    assert.ok(!args.includes('--dangerously-skip-permissions') && !args.includes('bypassPermissions'));
});

test('the gate probe has no tools', () => {
    const args = probeArgs();
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args[args.indexOf('--max-turns') + 1], '1');
});

test('quoteForCmd wraps every argument and refuses what cmd.exe would expand', () => {
    assert.equal(quoteForCmd('Bash(node tools/check-edit.mjs:*)'), '"Bash(node tools/check-edit.mjs:*)"');
    assert.equal(quoteForCmd(''), '""');
    assert.equal(quoteForCmd('a & b | c > d'), '"a & b | c > d"');
    assert.throws(() => quoteForCmd('say "hi"'));
    assert.throws(() => quoteForCmd('%PATH%'));
    // Every real argument passes
    [...agentArgs(), ...probeArgs()].forEach(quoteForCmd);
});

test('spawnSpec runs an .exe directly and a .cmd shim through cmd.exe, quoted', () => {
    const args = agentArgs();
    assert.deepEqual(spawnSpec({ file: 'C:\\bin\\claude.exe', viaCmd: false }, args),
        { file: 'C:\\bin\\claude.exe', args, windowsVerbatimArguments: false });

    const viaCmd = spawnSpec({ file: 'C:\\Program Files\\npm\\claude.cmd', viaCmd: true }, args);
    assert.deepEqual(viaCmd.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.equal(viaCmd.windowsVerbatimArguments, true);
    const line = viaCmd.args[3];
    assert.ok(line.startsWith('""C:\\Program Files\\npm\\claude.cmd" "-p"'), line);
    assert.ok(line.includes(' "Bash(node tools/check-edit.mjs:*)" '), line);
    assert.ok(line.includes(' "Read(**/.env*)" '), line);
});

test('describeEvent turns stream-json into short progress lines', () => {
    assert.deepEqual(describeEvent({
        type: 'assistant',
        message: {
            content: [
                { type: 'text', text: 'Reading the  forecast.' },
                { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\jobs\\abc\\forecast.json' } },
                { type: 'tool_use', name: 'Bash', input: { command: 'node tools/check-edit.mjs edit-plan.json' } }
            ]
        }
    }), ['Reading the forecast.', 'Read abc/forecast.json', 'Bash node tools/check-edit.mjs edit-plan.json']);
    assert.deepEqual(describeEvent({ type: 'result', is_error: false, result: 'done' }), ['finished']);
    assert.deepEqual(describeEvent({ type: 'result', is_error: true, result: 'Not logged in' }), ['failed: Not logged in']);
    assert.deepEqual(describeEvent({ type: 'system', subtype: 'init' }), []);
});
