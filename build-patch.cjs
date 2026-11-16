const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(process.env.DSH_INSTALL_DIR, '../dsh-web-app/presets/standard.patch.yml'), 'utf8');
const start = source.indexOf('          - id: persona');
if (start < 0) throw new Error('Unsupported standard preset: persona row not found');
const plugins = source.slice(start)
  .replace("disabled: !!js process.platform === 'win32'", 'disabled: false')
  .replace("disabled: !!js process.platform !== 'win32'", 'disabled: true');
const nested = plugins.split('\n').map(line => line ? '  ' + line : line).join('\n');
fs.writeFileSync(path.join(__dirname, 'cordis.patch.yml'), `# Standalone preset; never override a preset identity used by existing sessions.
- insert:
    - id: git-bash-diagnostics
      name: '@local/dsh-git-bash/diagnostics'
    - id: preset-git-bash
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: git-bash
        name: Git Bash
        description: Git for Windows Bash (Full access only)
        order: 5
        plugins:
          - id: git-bash-realm
            name: cordis:group
            group: true
            isolate:
              shell: true
            config:
              - id: git-bash-executor
                name: '@local/dsh-git-bash'
                config:
                  bashPath: 'E:/Softwares/Git/bin/bash.exe'
                  timeoutMs: 60000
${nested.split('\n').map(line => line ? '  ' + line : line).join('\n')}\n`);
