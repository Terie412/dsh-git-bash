import assert from 'node:assert/strict';
import { win32 as path } from 'node:path';
import test from 'node:test';
import { resolveGitBashPath } from '../git-bash-path.js';

const normalized = value => path.normalize(value).toLowerCase();
const registryOutput = root => Buffer.from(`\r\nHKEY_CURRENT_USER\\Software\\GitForWindows\r\n    InstallPath    REG_SZ    ${root}\r\n`);
function fixture({ roots = [], files = [], registry = {}, env = {}, run } = {}) {
  const existing = new Set(files.map(normalized));
  for (const root of roots) {
    existing.add(normalized(path.join(root, 'bin', 'bash.exe')));
    existing.add(normalized(path.join(root, 'cmd', 'git.exe')));
  }
  const calls = [];
  const probes = [];
  const deps = {
    path,
    env: { SystemRoot: 'C:\\Windows', PATH: '', ...env },
    isFile(file) { probes.push(file); return existing.has(normalized(file)); },
    run(executable, args, options) {
      calls.push({ executable, args, options });
      if (run) return run(executable, args, options);
      const value = registry[`${args[1]}:${args.at(-1)}`];
      if (value instanceof Error) throw value;
      if (Buffer.isBuffer(value)) return value;
      if (value !== undefined) return registryOutput(value);
      throw Object.assign(new Error('Registry key not found'), { status: 1 });
    },
  };
  return { deps, calls, probes };
}
const gitKey = hive => `${hive}\\Software\\GitForWindows`;
const regEntry = (hive, view) => `${gitKey(hive)}:/reg:${view}`;

test('exports only the synchronous resolver', async () => {
  const exports = await import('../git-bash-path.js');
  assert.deepEqual(Object.keys(exports), ['resolveGitBashPath']);
  const { deps } = fixture({ roots: ['D:\\Portable Git'] });
  assert.equal(resolveGitBashPath('D:/Portable Git/bin/bash.exe', deps), 'D:\\Portable Git\\bin\\bash.exe');
});

test('explicit path wins without launching registry or inspecting PATH', () => {
  const { deps, calls, probes } = fixture({ roots: ['D:\\Explicit', 'E:\\Registry', 'F:\\Path'], registry: { [regEntry('HKCU', 64)]: 'E:\\Registry' }, env: { PATH: 'F:\\Path\\cmd' } });
  assert.equal(resolveGitBashPath('D:\\Explicit\\bin\\bash.exe', deps), 'D:\\Explicit\\bin\\bash.exe');
  assert.equal(calls.length, 0);
  assert.equal(probes.length, 2);
});

for (const explicit of ['', 'bash.exe', 'Git\\bin\\bash.exe', '\\Git\\bin\\bash.exe', 'C:Git\\bin\\bash.exe', '/usr/bin/bash.exe', 'C:\\Windows\\System32\\bash.exe', 'C:\\msys64\\usr\\bin\\bash.exe', 'C:\\msys64\\bin\\bash.exe', 'D:\\Missing\\bin\\bash.exe', 'D:\\Git\\bin\\sh.exe', 42]) {
  test(`invalid explicit ${JSON.stringify(explicit)} throws without fallback`, () => {
    const { deps, calls } = fixture({ roots: ['E:\\Good'], files: typeof explicit === 'string' && explicit ? [explicit] : [], registry: { [regEntry('HKCU', 64)]: 'E:\\Good' }, env: { PATH: 'E:\\Good\\cmd' } });
    assert.throws(() => resolveGitBashPath(explicit, deps), /Invalid bashPath:.*Git for Windows.*bin\/bash\.exe.*cmd\/git\.exe/);
    assert.equal(calls.length, 0);
  });
}

test('file validation rejects directories or failed stat probes', () => {
  const { deps } = fixture({ roots: ['D:\\Git'] });
  deps.isFile = file => { if (file.endsWith('git.exe')) throw new Error('EACCES'); return true; };
  assert.throws(() => resolveGitBashPath('D:\\Git\\bin\\bash.exe', deps), /Invalid bashPath/);
  deps.isFile = () => false;
  assert.throws(() => resolveGitBashPath('D:\\Git\\bin\\bash.exe', deps), /Invalid bashPath/);
});

test('undefined and null discover; HKCU64 precedes HKCU32, HKLM and PATH', () => {
  for (const omitted of [undefined, null]) {
    const { deps, calls } = fixture({ roots: ['D:\\User64', 'D:\\User32', 'D:\\Machine', 'D:\\Path'], registry: { [regEntry('HKCU', 64)]: 'D:\\User64', [regEntry('HKCU', 32)]: 'D:\\User32', [regEntry('HKLM', 64)]: 'D:\\Machine' }, env: { PATH: 'D:\\Path\\cmd' } });
    assert.equal(resolveGitBashPath(omitted, deps), 'D:\\User64\\bin\\bash.exe');
    assert.equal(calls.length, 1);
  }
});

test('HKCU32 wins over HKLM64 after stale HKCU64', () => {
  const { deps, calls } = fixture({ roots: ['D:\\User32', 'D:\\Machine'], registry: { [regEntry('HKCU', 64)]: 'D:\\Uninstalled', [regEntry('HKCU', 32)]: 'D:\\User32', [regEntry('HKLM', 64)]: 'D:\\Machine' } });
  assert.equal(resolveGitBashPath(undefined, deps), 'D:\\User32\\bin\\bash.exe');
  assert.equal(calls.length, 2);
});

for (const view of [64, 32]) {
  test(`discovers HKLM ${view}-bit after missing or stale per-user keys`, () => {
    const { deps, calls } = fixture({ roots: ['D:\\Machine'], registry: { [regEntry('HKCU', 32)]: 'D:\\Stale', [regEntry('HKLM', view)]: 'D:\\Machine' } });
    assert.equal(resolveGitBashPath(undefined, deps), 'D:\\Machine\\bin\\bash.exe');
    assert.deepEqual(calls.map(call => [call.args[1], call.args.at(-1)]), [[gitKey('HKCU'), '/reg:64'], [gitKey('HKCU'), '/reg:32'], [gitKey('HKLM'), '/reg:64'], ...(view === 32 ? [[gitKey('HKLM'), '/reg:32']] : [])]);
  });
}

test('UTF-8 registry Unicode and spaces need no codepage query', () => {
  const root = 'E:\\便携 工具\\Git';
  const { deps, calls } = fixture({ roots: [root], registry: { [regEntry('HKCU', 64)]: root } });
  assert.equal(resolveGitBashPath(undefined, deps), `${root}\\bin\\bash.exe`);
  assert.equal(calls.length, 1);
});

test('ANSI registry output uses ASCII ACP query and a fatal matching decoder', () => {
  const root = 'E:\\中国 工具\\Git';
  const ansi = Buffer.concat([Buffer.from('    InstallPath    REG_SZ    E:\\'), Buffer.from('d6d0b9fa20b9a4bedf', 'hex'), Buffer.from('\\Git\r\n')]);
  const { deps, calls } = fixture({ roots: [root], run: (_exe, args) => args.includes('ACP') ? Buffer.from('    ACP    REG_SZ    936\r\n') : ansi });
  assert.equal(resolveGitBashPath(undefined, deps), `${root}\\bin\\bash.exe`);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP']);
});

test('unavailable or unsupported ACP skips undecodable registry and falls back', () => {
  for (const acp of ['99999', undefined]) {
    const { deps, calls } = fixture({ roots: ['E:\\Portable'], env: { PATH: 'E:\\Portable\\cmd' }, run: (_exe, args) => {
      if (!args.includes('ACP')) return Buffer.from([0xff]);
      if (acp === undefined) throw new Error('ACP denied');
      return Buffer.from(`    ACP    REG_SZ    ${acp}\r\n`);
    } });
    assert.equal(resolveGitBashPath(undefined, deps), 'E:\\Portable\\bin\\bash.exe');
    assert.equal(calls.filter(call => call.args.includes('ACP')).length, 1);
  }
});

for (const directory of ['cmd', 'bin', 'mingw64\\bin', 'mingw32\\bin']) {
  test(`PATH finds portable Git from ${directory}, preserving Unicode/spaces`, () => {
    const root = 'F:\\开发 软件\\Portable Git';
    const { deps } = fixture({ roots: [root], files: [path.join(root, directory, 'git.exe')], env: { PATH: `;relative\\cmd;C:\\Missing\\cmd;"${root}\\${directory}";D:\\Other\\cmd` } });
    assert.equal(resolveGitBashPath(undefined, deps), `${root}\\bin\\bash.exe`);
  });
}

test('PATH preserves entry priority and skips stale or incomplete Git installations', () => {
  const { deps } = fixture({ roots: ['D:\\First', 'D:\\Second'], files: ['C:\\Stale\\cmd\\git.exe'], registry: { [regEntry('HKCU', 64)]: 'C:\\Stale' }, env: { PATH: 'C:\\Stale\\cmd;D:\\First\\cmd;D:\\Second\\cmd' } });
  assert.equal(resolveGitBashPath(undefined, deps), 'D:\\First\\bin\\bash.exe');
});

test('case-insensitive environment variables and UNC Git installations work', () => {
  const root = '\\\\server\\工具 share\\Git';
  const { deps, calls } = fixture({ roots: [root] });
  deps.env = { sYsTeMrOoT: 'C:\\Windows', Path: `${root}\\cmd` };
  assert.equal(resolveGitBashPath(undefined, deps), `${root}\\bin\\bash.exe`);
  assert.equal(calls[0].executable, 'C:\\Windows\\System32\\reg.exe');
});

test('never probes cwd, generic bash, WSL shims, or relative PATH entries', () => {
  const { deps, probes } = fixture({ roots: ['D:\\Git'], files: ['C:\\Windows\\System32\\bash.exe', 'C:\\msys64\\usr\\bin\\bash.exe'], env: { PATH: ';.;D:Git\\cmd;\\Git\\cmd;bin;C:\\Windows\\System32;C:\\msys64\\usr\\bin' } });
  assert.throws(() => resolveGitBashPath(undefined, deps), /Git for Windows Bash was not found/);
  assert.deepEqual(probes, ['C:\\Windows\\System32\\git.exe', 'C:\\msys64\\usr\\bin\\git.exe']);
});

test('MSYS-like root is acceptable only with actual Git layout', () => {
  const { deps } = fixture({ roots: ['C:\\msys64'] });
  assert.equal(resolveGitBashPath('C:\\msys64\\bin\\bash.exe', deps), 'C:\\msys64\\bin\\bash.exe');
});

test('queries use absolute system reg.exe with bounded output/time and no shell', () => {
  const { deps, calls } = fixture({ env: { SystemRoot: 'D:\\系统 Windows' } });
  assert.throws(() => resolveGitBashPath(undefined, deps), /Install Git for Windows.*restart DSH.*PATH.*bashPath/);
  assert.equal(calls.length, 4);
  for (const { executable, options } of calls) {
    assert.equal(executable, 'D:\\系统 Windows\\System32\\reg.exe');
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 1500);
    assert.equal(options.maxBuffer, 65536);
    assert.equal(options.encoding, 'buffer');
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
  }
});

for (const code of ['ENOENT', 'EACCES', 'ETIMEDOUT', 'ENOBUFS']) {
  test(`registry process ${code} permits PATH fallback`, () => {
    const { deps, calls } = fixture({ roots: ['D:\\Git'], env: { PATH: 'D:\\Git\\cmd' }, run: () => { throw Object.assign(new Error(code), { code }); } });
    assert.equal(resolveGitBashPath(undefined, deps), 'D:\\Git\\bin\\bash.exe');
    assert.equal(calls.length, 4);
  });
}

test('missing or relative SystemRoot never launches untrusted reg.exe', () => {
  for (const SystemRoot of ['', 'Windows', '\\Windows']) {
    const { deps, calls } = fixture({ roots: ['D:\\Git'], env: { SystemRoot, PATH: 'D:\\Git\\cmd' } });
    assert.equal(resolveGitBashPath(undefined, deps), 'D:\\Git\\bin\\bash.exe');
    assert.equal(calls.length, 0);
  }
});

test('empty discovery gives actionable installation/configuration error', () => {
  const { deps } = fixture();
  assert.throws(() => resolveGitBashPath(undefined, deps), { message: 'Git for Windows Bash was not found. Install Git for Windows (or add your portable Git cmd/bin directory to PATH), then restart DSH to refresh PATH; alternatively ask your assistant to set bashPath in the local bundle cordis.patch.yml to its absolute bin/bash.exe path.' });
});
