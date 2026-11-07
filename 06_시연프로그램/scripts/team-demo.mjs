import {existsSync, mkdirSync, chmodSync, readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function readTeamSettings(env = process.env) {
  const required = {
    UPSTAGE_API_KEY: /\S+/,
    STUDIO_PROJECT_ID: /^proj_[\w-]+$/,
    STUDIO_REQUEST_AGENT_ID: /^agt_[\w-]+$/,
    STUDIO_RESULT_COLLECTION_ID: /^scol_[\w-]+$/,
    STUDIO_REGISTERED_CONTRACT_COLLECTION_ID: /^scol_[\w-]+$/,
  };
  const errors = [];
  for (const [key, pattern] of Object.entries(required)) {
    if (!env[key]?.trim() || !pattern.test(env[key].trim())) errors.push(`${key}를 확인하세요.`);
  }
  const contractAgent = env.STUDIO_CONTRACT_AGENT_ID?.trim();
  if (!/^agt_[\w-]+$/.test(contractAgent || '')) errors.push('STUDIO_CONTRACT_AGENT_ID를 확인하세요.');
  if (env.STUDIO_COWORKER_ID && !/^cw_[\w-]+$/.test(env.STUDIO_COWORKER_ID.trim())) errors.push('STUDIO_COWORKER_ID를 확인하세요.');
  const mode = env.STUDIO_CONFIG_MODE || 'latest';
  if (mode !== 'latest') errors.push('팀 공유판은 STUDIO_CONFIG_MODE=latest를 사용합니다.');
  if (env.STUDIO_REQUEST_CONFIG_ID !== undefined || env.STUDIO_CONTRACT_CONFIG_ID !== undefined) {
    errors.push('최신 저장 설정을 사용하므로 STUDIO_REQUEST_CONFIG_ID와 STUDIO_CONTRACT_CONFIG_ID 항목을 삭제하세요.');
  }
  const port = env.STUDIO_WEB_PORT || '3001';
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) errors.push('STUDIO_WEB_PORT는 1~65535 사이의 숫자여야 합니다.');
  if (errors.length) throw Error(errors.join('\n'));
  const settings = {...env, STUDIO_CONFIG_MODE: 'latest', DEMO_EXECUTION_PROVIDER: 'studio',
    DEMO_PUBLIC_API: 'disabled', NEXT_PUBLIC_DEMO_API_BASE: '',
    STUDIO_PRIVATE_ROOT: resolve(projectRoot, '.local-private/team-demo')};
  for (const key of Object.keys(required)) settings[key] = env[key].trim();
  settings.STUDIO_CONTRACT_AGENT_ID = contractAgent;
  if (settings.STUDIO_COWORKER_ID) settings.STUDIO_COWORKER_ID = settings.STUDIO_COWORKER_ID.trim();
  const workflows = {
    contract: {agentId: contractAgent, configMode: 'latest', collectionId: settings.STUDIO_REGISTERED_CONTRACT_COLLECTION_ID},
    request: {agentId: settings.STUDIO_REQUEST_AGENT_ID, configMode: 'latest', collectionId: settings.STUDIO_RESULT_COLLECTION_ID},
  };
  return {env: settings, workflows, port: +port, coworkerEnabled: !!settings.STUDIO_COWORKER_ID};
}

export function checkTeamPrerequisites(env = process.env) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw Error('Node.js 22.13.0 이상을 설치하세요.');
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('이 실행 안내는 macOS 기준입니다.');
  const checks = [
    [env.DEMO_PYTHON || 'python3', ['-c', 'import fcntl'], 'Python 3와 파일 잠금 기능을 확인하세요.'],
    ['pdfinfo', ['-v'], 'Poppler가 필요합니다. brew install poppler'],
    ['pdftoppm', ['-v'], 'Poppler가 필요합니다. brew install poppler'],
  ];
  for (const [command, args, message] of checks) {
    const result = spawnSync(command, args, {stdio: 'ignore', timeout: 10000, env});
    if (result.error || result.status !== 0) throw Error(message);
  }
  if (!existsSync(resolve(projectRoot, 'node_modules/vinext/dist/index.js'))) throw Error('먼저 npm ci를 실행하세요.');
}

export async function assertFreePort(port) {
  await new Promise((accept, reject) => {
    const probe = createNetServer();
    probe.once('error', () => reject(Error(`${port}번 포트를 사용 중입니다. 기존 실행을 종료하거나 .env.team.local의 STUDIO_WEB_PORT를 바꾸세요.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(accept));
  });
}

export async function main() {
  process.chdir(projectRoot);
  const envFile = resolve(projectRoot, '.env.team.local');
  if (!existsSync(envFile)) throw Error('설정 파일이 없습니다. cp .env.team.example .env.team.local 실행 후 API 키를 입력하세요.');
  chmodSync(envFile, 0o600);
  const settings = readTeamSettings({...process.env, ...parseEnv(readFileSync(envFile, 'utf8'))});
  checkTeamPrerequisites(settings.env);
  console.log('준비 확인: 설정 형식 · Node.js · Python · PDF 도구. API 인증은 아직 확인하지 않았습니다.');
  if (!settings.coworkerEnabled) console.log('보고 도우미: 미연결. STUDIO_COWORKER_ID 설정이 필요합니다.');
  if (process.argv.includes('--check')) return;
  await assertFreePort(settings.port);
  Object.assign(process.env, settings.env);
  mkdirSync(dirname(settings.env.STUDIO_PRIVATE_ROOT), {recursive: true, mode: 0o700});
  const [{createServer}, {default: vinext}, {studioApi}] = await Promise.all([
    import('vite'), import('vinext'), import('../lib/studio-api.mjs'),
  ]);
  const server = await createServer({
    root: projectRoot, configFile: false,
    plugins: [studioApi({env: settings.env, workflows: settings.workflows}), vinext()],
    server: {host: '127.0.0.1', port: settings.port, strictPort: true,
      fs: {deny: ['.env', '.env.*', '**/.git/**', '**/.local-private/**', '**/*.{pem,key}']}},
  });
  const stop = async () => {await server.close(); process.exit(0);};
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await server.listen();
  console.log(`은행원 http://127.0.0.1:${settings.port}/banker?session=team-demo-01`);
  console.log(`관리자 http://127.0.0.1:${settings.port}/admin?session=team-demo-01`);
  console.log('종료: Control+C. 실제 접수는 기존 팀 Studio와 컬렉션을 사용합니다.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {console.error('시작할 수 없습니다.\n' + error.message); process.exitCode = 1;});
}
