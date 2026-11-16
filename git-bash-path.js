import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';

const help = 'Install Git for Windows (or add your portable Git cmd/bin directory to PATH), then restart DSH to refresh PATH; alternatively ask your assistant to set bashPath in the local bundle cordis.patch.yml to its absolute bin/bash.exe path.';

/** Resolve once at executor construction; probes are injectable for tests on any OS. */
export function resolveGitBashPath(explicitPath, optionalDeps = {}) {
  const {
    path = win32,
    env = process.env,
    isFile = file => statSync(file).isFile(),
    run = execFileSync,
  } = optionalDeps;
  const envValue = name => env[Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase())] ?? '';
  // win32.isAbsolute also accepts root-relative paths such as \\bin\\bash.exe.
  // Require a drive or UNC share so discovery never depends on the current drive/directory.
  const absolute = value => typeof value === 'string' && path.isAbsolute(value)
    && /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/i.test(value);
  const fileExists = file => {
    try { return isFile(file) === true; } catch { return false; }
  };
  const validate = value => {
    if (!absolute(value)) return undefined;
    const bash = path.normalize(value);
    const bin = path.dirname(bash);
    if (path.basename(bash).toLowerCase() !== 'bash.exe' || path.basename(bin).toLowerCase() !== 'bin') return undefined;
    return fileExists(bash) && fileExists(path.join(path.dirname(bin), 'cmd', 'git.exe')) ? bash : undefined;
  };
  if (explicitPath !== undefined && explicitPath !== null) {
    const resolved = validate(explicitPath);
    if (resolved) return resolved;
    throw new Error(`Invalid bashPath: expected an existing absolute Git for Windows bin/bash.exe with cmd/git.exe in the same installation. ${help}`);
  }

  const systemRoot = envValue('SystemRoot');
  const reg = absolute(systemRoot) ? path.join(systemRoot, 'System32', 'reg.exe') : undefined;
  const query = args => {
    if (!reg) return undefined;
    try {
      return run(reg, ['query', ...args], {
        shell: false, windowsHide: true, timeout: 1500, maxBuffer: 64 * 1024,
        encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { return undefined; } // Missing keys, denied access and timeouts all permit fallback.
  };
  let ansiEncoding;
  let checkedEncoding = false;
  const decode = output => {
    if (output === undefined) return '';
    if (typeof output === 'string') return output;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(output); } catch { /* Windows reg.exe may emit ACP bytes. */ }
    if (!checkedEncoding) {
      checkedEncoding = true;
      // ACP is an ASCII number even when reg.exe's localized output uses ANSI.
      const acp = query(['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP']);
      const codepage = acp === undefined ? '' : Buffer.from(acp).toString('ascii').match(/^\s*ACP\s+REG_SZ\s+(\d+)\s*$/im)?.[1];
      ansiEncoding = ({ 65001: 'utf-8', 936: 'gbk', 54936: 'gb18030', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr', 874: 'windows-874' })[codepage]
        ?? (/^125[0-8]$/.test(codepage ?? '') ? `windows-${codepage}` : undefined);
    }
    if (!ansiEncoding) return '';
    try { return new TextDecoder(ansiEncoding, { fatal: true }).decode(output); } catch { return ''; }
  };
  for (const hive of ['HKCU', 'HKLM']) {
    for (const view of ['64', '32']) {
      const output = decode(query([`${hive}\\Software\\GitForWindows`, '/v', 'InstallPath', `/reg:${view}`]));
      const root = output.match(/^\s*InstallPath\s+REG_SZ\s+(.+?)\s*$/im)?.[1];
      if (!absolute(root)) continue;
      const resolved = validate(path.join(root, 'bin', 'bash.exe'));
      if (resolved) return resolved;
    }
  }

  // Inspect only absolute PATH directories, never where.exe's current-directory search.
  for (const entry of envValue('PATH').split(';')) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!absolute(directory) || !fileExists(path.join(directory, 'git.exe'))) continue;
    const name = path.basename(directory).toLowerCase();
    let root;
    if (name === 'cmd' || name === 'bin') {
      root = path.dirname(directory);
      if (name === 'bin' && /^mingw(?:32|64)$/i.test(path.basename(root))) root = path.dirname(root);
    }
    if (!root) continue;
    const resolved = validate(path.join(root, 'bin', 'bash.exe'));
    if (resolved) return resolved;
  }
  throw new Error(`Git for Windows Bash was not found. ${help}`);
}
