// The user's own Claude Code, run headless in an edit job folder. Session 2
// generalises this into an agent provider; for now it does one thing: start
// `claude -p` confined to one folder and stream what it does.
//
// Confinement (checked by claude.integration.test.ts):
//  - --setting-sources project loads only the job folder's own .claude (the
//    reel-edit skill), not the user's settings, hooks or plugins. --restricted
//    would confine files too, but it also drops project skills.
//  - --permission-mode dontAsk denies whatever isn't allowed instead of asking,
//    which includes any file outside the working directory.
//  - Read and Edit are allowed only under ./ (Edit rules govern the Write tool),
//    Bash only as `node tools/check-edit.mjs ...`; Claude Code checks each part
//    of a chained command, so `... && cat x` is refused.
//  - .env files and anything under ../ are denied outright.
// The prompt goes in on stdin, so argv is a constant with no user data in it.

import { execFileSync, spawn, spawnSync } from 'node:child_process';

export const AGENT_MODEL = 'claude-opus-5-5';
export const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

export const CONFINEMENT = [
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence',
    '--permission-mode', 'dontAsk',
    '--tools', 'Read,Write,Bash',
    '--allowedTools', 'Read(./**)', 'Edit(./**)', 'Bash(node tools/check-edit.mjs:*)',
    '--disallowedTools', 'Read(**/.env*)', 'Read(../**)', 'Edit(../**)'
];

/** argv for a planning run. Constant: the prompt is written to stdin. */
export const agentArgs = (): string[] =>
    ['-p', '--model', AGENT_MODEL, '--output-format', 'stream-json', '--verbose', ...CONFINEMENT];

/** argv for the gate's one-turn probe: no tools at all. */
export const probeArgs = (): string[] =>
    ['-p', '--model', AGENT_MODEL, '--output-format', 'json', '--max-turns', '1',
        '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--tools', ''];

/**
 * One argument quoted for cmd.exe, for a claude installed as a .cmd shim. Inside
 * double quotes cmd treats & | < > ( ) * : and spaces literally; " and % would
 * still be live, and no argument here may contain them.
 */
export function quoteForCmd(arg: string): string {
    if (/["%\r\n]/.test(arg)) throw new Error(`cannot pass ${JSON.stringify(arg)} through cmd.exe safely`);
    return `"${arg}"`;
}

export interface ClaudeCommand {
    file: string;
    /** cmd.exe has to run it (a .cmd or .bat shim); arguments are then quoted by quoteForCmd. */
    viaCmd: boolean;
}

/** Where the claude executable is, or undefined when it isn't on PATH. */
export function findClaude(platform = process.platform): ClaudeCommand | undefined {
    if (platform !== 'win32') {
        try {
            return { file: execFileSync('which', ['claude'], { encoding: 'utf8' }).trim().split('\n')[0], viaCmd: false };
        } catch {
            return undefined;
        }
    }
    let found: string[];
    try {
        found = execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
    } catch {
        return undefined;
    }
    const exe = found.find(file => /\.exe$/i.test(file));
    if (exe) return { file: exe, viaCmd: false };
    const shim = found.find(file => /\.(cmd|bat)$/i.test(file));
    return shim ? { file: shim, viaCmd: true } : undefined;
}

/** What spawn() gets: the executable runs directly, or cmd.exe runs the shim with every argument quoted. */
export function spawnSpec(command: ClaudeCommand, args: string[]): { file: string; args: string[]; windowsVerbatimArguments: boolean } {
    if (!command.viaCmd) return { file: command.file, args, windowsVerbatimArguments: false };
    const line = [command.file, ...args].map(quoteForCmd).join(' ');
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}

/** Stop the run and everything it started (Bash children included). */
function killTree(pid: number | undefined): void {
    if (!pid) return;
    if (process.platform === 'win32') {
        try {
            execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } catch {
            // already gone
        }
    } else {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch {
            // already gone
        }
    }
}

/** One stream-json event as a short progress line, or nothing worth showing. */
export function describeEvent(event: Record<string, unknown>): string[] {
    const message = event.message as { content?: Record<string, unknown>[] } | undefined;
    if (event.type === 'assistant' && Array.isArray(message?.content)) {
        return message.content.flatMap(block => {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
                const text = block.text.trim().replace(/\s+/g, ' ');
                return [text.length > 200 ? `${text.slice(0, 199)}…` : text];
            }
            if (block.type === 'tool_use') {
                const input = (block.input ?? {}) as Record<string, unknown>;
                const target = typeof input.file_path === 'string'
                    ? input.file_path.split(/[\\/]/).slice(-2).join('/')
                    : String(input.command ?? '').slice(0, 160);
                return [`${block.name} ${target}`.trim()];
            }
            return [];
        });
    }
    if (event.type === 'result') return [event.is_error ? `failed: ${String(event.result ?? event.subtype)}` : 'finished'];
    return [];
}

export interface AgentRun {
    ok: boolean;
    result: string;
    /** Tool calls the permission rules refused. */
    denials: { tool_name: string; tool_input: Record<string, unknown> }[];
    timedOut: boolean;
}

/** Run claude with a fixed argv in cwd, the prompt on stdin. Resolves when it exits or is killed. */
export function runClaude({ cwd, prompt, args = agentArgs(), onLine = () => {}, onEvent = () => {}, timeoutMs = AGENT_TIMEOUT_MS }: {
    cwd: string;
    prompt: string;
    args?: string[];
    onLine?: (line: string) => void;
    onEvent?: (event: Record<string, unknown>) => void;
    timeoutMs?: number;
}): Promise<AgentRun> {
    const command = findClaude();
    if (!command) return Promise.resolve({ ok: false, result: 'claude is not on PATH', denials: [], timedOut: false });
    const spec = spawnSpec(command, args);

    return new Promise(resolve => {
        const child = spawn(spec.file, spec.args, {
            cwd,
            windowsHide: true,
            windowsVerbatimArguments: spec.windowsVerbatimArguments,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
        let last: Record<string, unknown> | undefined;
        let buffered = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            buffered += chunk;
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                let event: Record<string, unknown>;
                try {
                    event = JSON.parse(line);
                } catch {
                    continue;
                }
                onEvent(event);
                describeEvent(event).forEach(onLine);
                // --output-format json prints one result object; stream-json ends with one
                if (event.type === 'result') last = event;
            }
        });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
        child.on('error', error => { stderr += error.message; });
        child.on('close', code => {
            clearTimeout(timer);
            if (buffered.trim()) {
                try { last = JSON.parse(buffered); } catch { /* partial line */ }
            }
            const result = timedOut
                ? `stopped after ${Math.round(timeoutMs / 60000)} min`
                : String(last?.result ?? (stderr.trim() || `claude exited with code ${code}`));
            resolve({
                ok: !timedOut && code === 0 && last?.is_error === false,
                result,
                denials: (last?.permission_denials as AgentRun['denials']) ?? [],
                timedOut
            });
        });
        child.stdin.end(prompt);
    });
}

export interface Gate {
    ok: boolean;
    /** What is missing: the CLI, a login, access to the model, or the call failed for another reason. */
    missing: 'cli' | 'auth' | 'model' | 'call' | null;
    version?: string;
    model: string;
    detail?: string;
    checkedAt: number;
}

const GATE_TTL_MS = 10 * 60 * 1000;
const gateCache = globalThis as unknown as { __claudeGate?: Gate };

/**
 * Can this machine plan edits? The CLI is on PATH and a one-turn call to the
 * model succeeds. Cached for 10 minutes. A convenience check in open-source
 * code, not a licence check.
 */
export async function checkGate({ fresh = false, cwd = process.cwd() }: { fresh?: boolean; cwd?: string } = {}): Promise<Gate> {
    const cached = gateCache.__claudeGate;
    if (!fresh && cached && Date.now() - cached.checkedAt < GATE_TTL_MS) return cached;
    const gate = await probeGate(cwd);
    gateCache.__claudeGate = gate;
    return gate;
}

async function probeGate(cwd: string): Promise<Gate> {
    const base = { model: AGENT_MODEL, checkedAt: Date.now() };
    const command = findClaude();
    if (!command) return { ...base, ok: false, missing: 'cli', detail: 'claude was not found on PATH' };
    const spec = spawnSpec(command, ['--version']);
    const probe = spawnSync(spec.file, spec.args, { encoding: 'utf8', windowsHide: true, timeout: 30000, windowsVerbatimArguments: spec.windowsVerbatimArguments });
    if (probe.status !== 0) {
        return { ...base, ok: false, missing: 'cli', detail: (probe.error?.message ?? probe.stderr ?? '').slice(0, 300) };
    }
    const version = probe.stdout.trim();
    const run = await runClaude({ cwd, prompt: 'Reply with the single word OK.', args: probeArgs(), timeoutMs: 120000 });
    if (run.ok) return { ...base, ok: true, missing: null, version };
    const detail = run.result.slice(0, 300);
    const missing = /log ?in|auth|api key|credential|401|403/i.test(detail) ? 'auth'
        : /model|not.?found|404|access/i.test(detail) ? 'model'
            : 'call';
    return { ...base, ok: false, missing, version, detail };
}
