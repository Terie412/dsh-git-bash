import { resolveGitBashPath } from './git-bash-path.js';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox';
import z from '@deepseek-ai/schemastery';

export default class GitBashExecutor extends LocalBashExecutor {
  static inject = ['subprocess', 'sandboxPolicy', 'systemPrompt'];
  static Config = z.object({
    ...LocalBashExecutor.Config.dict,
    bashPath: z.string().description('Optional absolute Git for Windows bin/bash.exe path. Leave unset to detect Git automatically.'),
  });

  constructor(ctx, config) {
    super(ctx, config);
    if (process.platform !== 'win32') throw new Error('Git Bash requires Windows.');
    // Resolve once on activation; commands reuse this validated installation.
    this.bashPath = resolveGitBashPath(config.bashPath);
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'local:git-bash',
      order: 1001,
      text: 'The bash tool runs Git for Windows Bash directly, not PowerShell, cmd, or WSL. Use Bash syntax. Pass native absolute Windows paths (for example E:/project) to tool workdir; use /e/project or cygpath inside Bash commands. Each call is a fresh non-login shell with no startup files. Git Bash commands are supported only under danger-full-access; restricted policies fail closed. Do not use another shell to bypass that refusal. Use native read/edit/glob/grep tools for file operations as instructed. Do not use pwsh or powershell as an alternate command shell. Git Bash can still launch native Windows programs such as node and git.',
    }), 'git-bash.guidance');
  }

  get sandboxMode() {
    // Make the stock tool resolve the CALLING SESSION's policy for every call.
    return this.ctx.sandboxPolicy.defaultMode;
  }

  resolve(request) {
    return { ...super.resolve(request), sandboxPolicy: request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() };
  }

  async execute(spec) {
    const mode = spec.sandboxPolicy?.mode;
    if (mode !== 'danger-full-access') {
      throw new SandboxUnavailableError(mode ?? 'read-only',
        'Git Bash supports Full access only; the command was not started. No PowerShell fallback is used.');
    }
    const execution = await this.executeArgv({
      ...spec,
      // BASH_ENV can otherwise execute startup scripts even for a non-login shell.
      env: { ...spec.env, BASH_ENV: '', ENV: '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    }, [this.bashPath, '--noprofile', '--norc', '-c', spec.command]);
    const base = execution.result.bind(execution);
    let result;
    execution.result = () => result ??= base().then(value => ({ ...value, sandbox: { mode, denied: false } }));
    return execution;
  }
}
