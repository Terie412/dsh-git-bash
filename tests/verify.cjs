const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const r = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'package.json'));
const { Context } = r('@deepseek-ai/cordis');
const Subprocess = r('@deepseek-ai/dsh-subprocess-local').default;

(async () => {
  const root = path.resolve(__dirname, '..');
  // Standalone test processes do not inherit the Host's peer resolver.
  const peers = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).peerDependencies));
  const resolvedPeers = new Map([...peers].map(name => [name, pathToFileURL(r.resolve(name)).href]));
  const hooks = require('node:module').registerHooks({
    resolve(specifier, context, next) {
      return resolvedPeers.has(specifier) ? next(resolvedPeers.get(specifier), context) : next(specifier, context);
    },
  });
  const installation = process.env.DSH_INSTALL_DIR;
  let Executor;
  try {
    delete process.env.DSH_INSTALL_DIR;
    Executor = (await import(pathToFileURL(path.join(root, 'index.js')).href)).default;
  } finally { process.env.DSH_INSTALL_DIR = installation; hooks.deregister(); }
  console.log('PASS executor imports without subprocess-only DSH_INSTALL_DIR');
  const ctx = new Context();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bash-'));
  const cwd = path.join(dir, '中文 空格');
  fs.mkdirSync(cwd);
  const full = { mode: 'danger-full-access', workspaceRoot: cwd };
  ctx.provide('sandboxPolicy', { defaultMode: 'workspace-write', resolve: () => full });
  const sections = [];
  ctx.provide('systemPrompt', { section: s => { sections.push(s); return () => {}; } });
  try {
    await ctx.plugin(Subprocess);
    await ctx.plugin(Executor, { bashPath: 'E:/Softwares/Git/bin/bash.exe', graceMs: 100, timeoutMs: 2000 });
    const run = async (command, extra = {}) => (await ctx.shell.execute(ctx.shell.resolve({ command, workdir: cwd, sandboxPolicy: full, ...extra }))).result();
    let value = await run("printf '%s\\n' \"$BASH\" \"$BASH_VERSION\"; pwd; printf '中文输出\\n'; git --version; node --version");
    assert.equal(value.exitCode, 0, value.stderr.text);
    assert.match(value.stdout.text, /中文输出/); assert.match(value.stdout.text, /git version/);
    assert.match(value.stdout.text, /中文 空格/); assert.match(value.stdout.text, /bash/);
    console.log('PASS Git Bash, Unicode/spaced cwd, Git, Node:', value.stdout.text.trim());
    value = await run('printf error >&2; exit 7'); assert.equal(value.exitCode, 7); assert.equal(value.stderr.text, 'error');
    console.log('PASS nonzero exit and stderr');
    for (const mode of ['read-only', 'workspace-write']) {
      await assert.rejects(run('touch SHOULD_NOT_EXIST', { sandboxPolicy: { mode, workspaceRoot: cwd } }), /Full access only/);
    }
    assert.equal(fs.existsSync(path.join(cwd, 'SHOULD_NOT_EXIST')), false);
    console.log('PASS restricted policies refuse execution');
    value = await run('printf 123456789012345678901234567890', { stdoutMaxBytes: 8 });
    assert.equal(value.stdout.truncated, true); assert.ok(value.stdout.spillPath);
    console.log('PASS bounded output and spill');
    const background = await ctx.shell.execute(ctx.shell.resolve({ command: "printf first; sleep 0.1; printf second", workdir: cwd, onExpiry: 'none', sandboxPolicy: full }));
    await background.done; assert.equal(background.readOutput().delta, 'firstsecond'); assert.equal(background.readOutput().delta, '');
    console.log('PASS background handle and incremental output');
    const cancel = await ctx.shell.execute(ctx.shell.resolve({ command: 'sleep 30', workdir: cwd, onExpiry: 'none', sandboxPolicy: full }));
    assert.equal(cancel.kill(), true); await cancel.done; assert.equal(cancel.status, 'killed');
    console.log('PASS cancellation');
    value = await run('sleep 30', { timeoutMs: 150 }); assert.equal(value.timedOut, true);
    console.log('PASS deadline termination');
    assert.equal(sections[0].name, 'local:git-bash');
    for (const f of ['package.json', 'locale/en.json', 'locale/zh.json']) JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    const yaml = r('js-yaml');
    const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: x => x })]);
    const patch = yaml.load(fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8'), { schema });
    assert.equal(patch.length, 1);
    assert.deepEqual(Object.keys(patch[0]), ['insert']);
    const preset = patch[0].insert.find(row => row.id === 'preset-git-bash');
    assert.equal(preset.id, 'preset-git-bash');
    assert.equal(preset.config.id, 'git-bash');
    assert.equal(preset.config.name, 'Git Bash');
    const group = preset.config.plugins[0]; assert.equal(group.isolate.shell, true);
    assert.equal(group.config.find(x => x.id === 'tool-bash').disabled, false);
    assert.equal(group.config.find(x => x.id === 'tool-pwsh').disabled, true);
    const shipped = yaml.load(fs.readFileSync(path.join(process.env.DSH_INSTALL_DIR, '../dsh-web-app/presets/standard.patch.yml'), 'utf8'), { schema })[0].insert[0].config.plugins;
    const expected = shipped.map(row => row.id === 'tool-bash' ? { ...row, disabled: false } : row.id === 'tool-pwsh' ? { ...row, disabled: true } : row);
    assert.deepEqual(group.config.slice(1), expected);
    assert.deepEqual(patch[0].insert.map(row => row.id), ['git-bash-diagnostics', 'preset-git-bash']);
    assert.ok(!JSON.stringify(patch).includes('preset-standard'));
    console.log('PASS standalone preset: no standard override or default change; isolation, tool switches and exact preservation of shipped plugins');
  } finally {
    await ctx.fiber.dispose();
    // Only remove the unique temporary directory created by this test.
    assert.ok(dir.startsWith(path.join(os.tmpdir(), 'dsh-git-bash-')));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
