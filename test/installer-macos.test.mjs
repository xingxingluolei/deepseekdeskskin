import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installer = process.env.INSTALLER_UNDER_TEST || fileURLToPath(new URL('../scripts/install-macos.sh', import.meta.url));
const source = readFileSync(installer, 'utf8');
const version = source.match(/^dss_version='([^']+)'/m)?.[1];
const packageName = source.match(/^dss_package='([^']+)'/m)?.[1];
const digest = source.match(/^dss_sha256='([a-f0-9]{64})'/m)?.[1];
assert.ok(version && packageName && digest, 'installer must pin a release version, filename, and SHA-256');

// Invoke the real system Bash (3.2 on macOS). Every network/DSH command is a
// fixture; no test downloads a release or reads/modifies the real DSH profile.
function fixture(t, overrides = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dss installer test ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const app = path.join(root, 'Applications With Spaces', 'DeepSeek Harness.app');
  const cli = path.join(app, 'Contents/Resources/runtime/cli/bin/dsh');
  const home = path.join(root, 'home');
  const skinHome = path.join(root, 'skin home');
  const eventLog = path.join(root, 'events.log');
  const dshHome = path.join(root, 'isolated dsh home');
  const profile = path.join(dshHome, 'profiles/desktop');
  const installedPackage = path.join(profile, 'node_modules/deepseekdeskskin-harness');
  mkdirSync(installedPackage, { recursive: true });
  writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['deepseekdeskskin-harness'] } } }));
  for (const directory of [bin, path.dirname(cli), home, skinHome]) mkdirSync(directory, { recursive: true });
  writeFileSync(eventLog, '');
  const logger = `log() { printf '%s' "$1" >> "$MOCK_EVENT_LOG"; shift; for argument in "$@"; do printf '\\t%s' "$argument" >> "$MOCK_EVENT_LOG"; done; printf '\\n' >> "$MOCK_EVENT_LOG"; }\n`;
  const executable = (filename, body) => writeFileSync(filename, `#!/bin/bash\nset -eu\n${logger}${body}\n`, { mode: 0o755 });
  const electron = path.join(app, 'Contents/MacOS/DeepSeek Harness');
  mkdirSync(path.dirname(electron), { recursive: true });
  executable(electron, 'exec "$MOCK_NODE_BINARY" "$@"');
  executable(path.join(bin, 'uname'), `printf '%s\\n' "\${MOCK_OS:-Darwin}"`);
  executable(path.join(bin, 'id'), `printf '%s\\n' "\${MOCK_UID:-501}"`);
  executable(path.join(bin, 'curl'), `
log curl "$@"
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then output="$2"; shift 2; else shift; fi
done
[ -n "$output" ] || exit 91
printf 'fixture release archive' > "$output"
[ "\${MOCK_CURL_FAIL:-0}" != '1' ] || exit 22
`);
  executable(path.join(bin, 'shasum'), `
log shasum "$@"
[ "$#" -eq 3 ] && [ "$1" = '-a' ] && [ "$2" = '256' ] || exit 92
[ -f "$3" ] || exit 1
[ "\${MOCK_HASH_COMMAND_FAIL:-0}" != '1' ] || exit 1
if [ "\${MOCK_HASH_BAD:-0}" = '1' ] || [ "$(cat "$3")" != 'fixture release archive' ]; then
  printf '%s  %s\\n' '0000000000000000000000000000000000000000000000000000000000000000' "$3"
else
  printf '%s  %s\\n' "$MOCK_EXPECTED_SHA256" "$3"
fi
`);
  executable(cli, `
log cli "$@"
[ "\${MOCK_CLI_FAIL:-0}" != '1' ] || { printf 'fixture CLI failure\\n' >&2; exit 17; }
is_list=0
is_add=0
for argument in "$@"; do
  [ "$argument" != 'list' ] || is_list=1
  [ "$argument" != 'add' ] || is_add=1
done
if [ "$is_add" = '1' ]; then
  printf '{"name":"deepseekdeskskin-harness","version":"%s"}\\n' "\${MOCK_LIST_VERSION:-$MOCK_EXPECTED_VERSION}" > "$MOCK_INSTALLED_PACKAGE/package.json"
fi
if [ "$is_list" = '1' ]; then
  [ "\${MOCK_LIST_FAIL:-0}" != '1' ] || exit 18
  if [ "\${MOCK_LIST_INVALID:-0}" = '1' ]; then printf 'not JSON\\n'; else
    if [ "\${MOCK_LIST_MISSING:-0}" = '1' ]; then printf '[]\\n'; else
      printf '[{"path":"%s","dependencies":{"deepseekdeskskin-harness":{"path":"%s","version":"%s"}}}]\\n' "$MOCK_PROFILE" "$MOCK_INSTALLED_PACKAGE" "\${MOCK_LIST_VERSION:-$MOCK_EXPECTED_VERSION}"
    fi
  fi
fi
`);
  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    DEEPSEEKDESKSKIN_HOME: skinHome,
    DSH_HOME: dshHome,
    MOCK_NODE_BINARY: process.execPath,
    MOCK_PROFILE: profile,
    MOCK_INSTALLED_PACKAGE: installedPackage,
    MOCK_EVENT_LOG: eventLog,
    MOCK_EXPECTED_SHA256: digest,
    MOCK_EXPECTED_VERSION: version,
    ...overrides,
  };
  const cacheDir = path.join(skinHome, 'downloads', `v${version}`);
  return {
    root, app, cacheDir, profile,
    cachePackage: path.join(cacheDir, packageName),
    run(args = [], extraEnv = {}) {
      const result = spawnSync('/bin/bash', [installer, '--app', app, ...args], {
        env: { ...env, ...extraEnv }, cwd: root, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined, 'installer process must finish without a spawn error or timeout');
      return { ...result, output: `${result.stdout}${result.stderr}` };
    },
    events() { return readFileSync(eventLog, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('\t')); },
    package(filename = 'local package.tgz', content = 'fixture release archive') {
      const output = path.join(root, filename);
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, content);
      return output;
    },
    assertNoDownloadOrCli() {
      assert.deepEqual(this.events().filter(([kind]) => kind === 'curl' || kind === 'cli'), []);
    },
    assertNoTemporaryDownloads() {
      let files = [];
      try { files = readdirSync(cacheDir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      assert.deepEqual(files.filter(name => name.startsWith('.download.')), [], 'partial release archives must be cleaned');
    },
  };
}

function success(result) {
  assert.equal(result.status, 0, result.output);
}
function failure(result) {
  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /皮肤 v[^\n]+ 已安装/);
}
function mutations(f) {
  return f.events().filter(event => event[0] === 'cli' && (event.includes('add') || event.includes('remove')));
}

// Explicit --app means even a machine with a real DSH install cannot make the
// missing-client test unexpectedly succeed or mutate that client's profile.
test('installer refuses unsupported platforms before download or CLI use', t => {
  const f = fixture(t, { MOCK_OS: 'Linux' });
  const result = f.run();
  failure(result);
  assert.match(result.output, /仅支持 macOS/);
  f.assertNoDownloadOrCli();
});

test('installer refuses sudo/root before download or CLI use', t => {
  const f = fixture(t, { MOCK_UID: '0' });
  const result = f.run();
  failure(result);
  assert.match(result.output, /不要加 sudo/);
  f.assertNoDownloadOrCli();
});

test('missing explicitly selected app is rejected without falling back to a real app', t => {
  const f = fixture(t);
  const result = f.run(['--app', path.join(f.root, 'missing app.app')]);
  failure(result);
  assert.match(result.output, /指定目录不是可用的/);
  f.assertNoDownloadOrCli();
});

test('missing --app argument is rejected without downloading', t => {
  const f = fixture(t);
  failure(f.run(['--app']));
  f.assertNoDownloadOrCli();
});

test('--check is read-only, even when a package path is supplied', t => {
  const f = fixture(t);
  success(f.run(['--check', '--package', path.join(f.root, 'nonexistent.tgz')]));
  assert.deepEqual(f.events(), []);
});

test('mutually exclusive actions are rejected', t => {
  const f = fixture(t);
  failure(f.run(['--check', '--uninstall']));
  f.assertNoDownloadOrCli();
});

test('local package and app paths with spaces arrive at the CLI as intact arguments', t => {
  const f = fixture(t);
  const pkg = f.package('release files/package with spaces.tgz');
  success(f.run(['--app', `${f.app}/`, '--package', pkg]));
  assert.deepEqual(mutations(f), [['cli', 'plugin', '--profile', 'desktop', 'add', f.cachePackage, '--ignore-scripts']]);
  assert.equal(f.events().filter(([kind]) => kind === 'curl').length, 0);
  assert.deepEqual(f.events().find(([kind]) => kind === 'shasum'), ['shasum', '-a', '256', pkg]);
  assert.equal(readFileSync(f.cachePackage, 'utf8'), 'fixture release archive');
  const hashIndex = f.events().findIndex(([kind]) => kind === 'shasum');
  const cliIndex = f.events().findIndex(event => event[0] === 'cli' && event.includes('add'));
  assert.ok(hashIndex >= 0 && hashIndex < cliIndex, 'local checksum must pass before install');
});

test('local checksum mismatch never invokes the official CLI', t => {
  const f = fixture(t);
  failure(f.run(['--package', f.package('incorrect.tgz', 'corrupt archive')]));
  f.assertNoDownloadOrCli();
});

test('first download verifies SHA-256 before official desktop-profile installation', t => {
  const f = fixture(t);
  success(f.run());
  const events = f.events();
  const curls = events.filter(([kind]) => kind === 'curl');
  assert.equal(curls.length, 1);
  assert.ok(curls[0].includes(`https://github.com/xingxingluolei/deepseekdeskskin/releases/download/v${version}/${packageName}`));
  assert.ok(curls[0].includes('--fail'));
  assert.ok(curls[0].includes('--proto-redir'));
  assert.ok(curls[0].includes('=https'));
  const downloadIndex = events.findIndex(([kind]) => kind === 'curl');
  const hashIndex = events.findIndex(([kind]) => kind === 'shasum');
  const installIndex = events.findIndex(event => event[0] === 'cli' && event.includes('add'));
  assert.ok(downloadIndex < hashIndex && hashIndex < installIndex, 'download must be verified before installation');
  assert.deepEqual(mutations(f), [['cli', 'plugin', '--profile', 'desktop', 'add', f.cachePackage, '--ignore-scripts']]);
  assert.equal(readFileSync(f.cachePackage, 'utf8'), 'fixture release archive');
  f.assertNoTemporaryDownloads();
});

test('downloaded checksum mismatch never calls CLI and deletes partial archive', t => {
  const f = fixture(t, { MOCK_HASH_BAD: '1' });
  failure(f.run());
  assert.equal(f.events().filter(([kind]) => kind === 'cli').length, 0);
  assert.equal(f.events().filter(([kind]) => kind === 'curl').length, 1);
  f.assertNoTemporaryDownloads();
});

test('failed curl never calls CLI and deletes partial archive', t => {
  const f = fixture(t, { MOCK_CURL_FAIL: '1' });
  failure(f.run());
  assert.equal(f.events().filter(([kind]) => kind === 'cli').length, 0);
  assert.equal(f.events().filter(([kind]) => kind === 'curl').length, 1);
  f.assertNoTemporaryDownloads();
});

test('valid cached archive is rechecked and installed without curl', t => {
  const f = fixture(t);
  mkdirSync(f.cacheDir, { recursive: true });
  writeFileSync(f.cachePackage, 'fixture release archive');
  success(f.run());
  assert.equal(f.events().filter(([kind]) => kind === 'curl').length, 0);
  assert.equal(f.events()[0][0], 'shasum');
  assert.deepEqual(mutations(f), [['cli', 'plugin', '--profile', 'desktop', 'add', f.cachePackage, '--ignore-scripts']]);
});

test('corrupt cache is replaced by a fresh verified download', t => {
  const f = fixture(t);
  mkdirSync(f.cacheDir, { recursive: true });
  writeFileSync(f.cachePackage, 'corrupt old cache');
  success(f.run());
  assert.equal(f.events().filter(([kind]) => kind === 'curl').length, 1);
  assert.equal(readFileSync(f.cachePackage, 'utf8'), 'fixture release archive');
  f.assertNoTemporaryDownloads();
});

test('repeated installs use add/update without first removing the existing plugin', t => {
  const f = fixture(t);
  success(f.run());
  success(f.run());
  assert.equal(f.events().filter(([kind]) => kind === 'curl').length, 1);
  assert.equal(mutations(f).length, 2);
  assert.ok(mutations(f).every(event => event.includes('add') && !event.includes('remove')));
});

test('official CLI installation failure is not reported as success and retains validated cache', t => {
  const f = fixture(t, { MOCK_CLI_FAIL: '1' });
  const result = f.run();
  failure(result);
  assert.match(result.output, /官方 CLI 安装失败/);
  assert.equal(readFileSync(f.cachePackage, 'utf8'), 'fixture release archive');
  f.assertNoTemporaryDownloads();
});

test('--uninstall only calls official remove, with no download or checksum work', t => {
  const f = fixture(t);
  const result = f.run(['--uninstall']);
  success(result);
  assert.match(result.output, /皮肤已卸载/);
  assert.deepEqual(f.events(), [['cli', 'plugin', '--profile', 'desktop', 'remove', 'deepseekdeskskin-harness']]);
});

test('official CLI uninstall failure is not reported as successful uninstall', t => {
  const f = fixture(t, { MOCK_CLI_FAIL: '1' });
  const result = f.run(['--uninstall']);
  failure(result);
  assert.doesNotMatch(result.output, /皮肤已卸载/);
  assert.deepEqual(f.events(), [['cli', 'plugin', '--profile', 'desktop', 'remove', 'deepseekdeskskin-harness']]);
});


test('missing desktop profile fails before downloading or changing plugins', t => {
  const f = fixture(t);
  rmSync(path.join(f.profile, 'package.json'));
  const result = f.run();
  failure(result);
  assert.match(result.output, /desktop profile/);
  f.assertNoDownloadOrCli();
});

test('malformed desktop profile fails --check without changing files', t => {
  const f = fixture(t);
  const file = path.join(f.profile, 'package.json');
  writeFileSync(file, 'invalid JSON');
  failure(f.run(['--check']));
  assert.equal(readFileSync(file, 'utf8'), 'invalid JSON');
  f.assertNoDownloadOrCli();
});

test('an installed version mismatch does not report success', t => {
  const f = fixture(t, { MOCK_LIST_VERSION: '0.0.0' });
  const result = f.run();
  failure(result);
  assert.match(result.output, /版本核对/);
  assert.equal(mutations(f).length, 1);
  assert.ok(f.events().some(event => event[0] === 'cli' && event.includes('list')));
});

test('failed official inventory check does not report success', t => {
  const f = fixture(t, { MOCK_LIST_FAIL: '1' });
  const result = f.run();
  failure(result);
  assert.match(result.output, /安装结果检查失败/);
  assert.equal(mutations(f).length, 1);
});

test('invalid official inventory JSON does not report success', t => {
  const f = fixture(t, { MOCK_LIST_INVALID: '1' });
  failure(f.run());
  assert.equal(mutations(f).length, 1);
});

test('official inventory missing the skin does not report success', t => {
  const f = fixture(t, { MOCK_LIST_MISSING: '1' });
  failure(f.run());
  assert.equal(mutations(f).length, 1);
});

test('an existing disabled skin remains disabled and installation explains how to enable it', t => {
  const f = fixture(t);
  const file = path.join(f.profile, 'package.json');
  const disabled = JSON.stringify({ dsh: { profile: { bundles: [] } } });
  writeFileSync(file, disabled);
  const result = f.run();
  success(result);
  assert.match(result.output, /之前停用插件的设置/);
  assert.equal(readFileSync(file, 'utf8'), disabled);
});
