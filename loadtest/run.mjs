#!/usr/bin/env node
// Runs the k6 load tests against the production image on an isolated
// `etkin_load` database, then checks what the database recorded.
//
// Prerequisites: Docker running, `pnpm infra:up`, and the app image built
// (`docker compose --profile app build`).
// Usage: node loadtest/run.mjs [gate|drop|all]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOADTEST = fileURLToPath(new URL('.', import.meta.url));
const API_DIR = fileURLToPath(new URL('../apps/api/', import.meta.url));
const K6_IMAGE = 'grafana/k6:2.3.0';
const APP_IMAGE = 'etkin-api:latest';
const NETWORK = 'etkin_default';
const POSTGRES = 'etkin-postgres-1';
const HOST_PORT = 3100;
const CONTAINERS = { api: 'etkin-load-api', worker: 'etkin-load-worker' };

// Load-test-only secrets, shared by the seed script and the containers.
const SECRETS = {
  JWT_ACCESS_SECRET: 'load-test-only-jwt-secret-0123456789abcdef',
  QR_MASTER_KEY: 'ZxTx59mUcQeuwBH2diaEZ7rzec1DY6JxzyDI6jREJ2M=',
};

const scenarios = { gate: ['gate'], drop: ['drop'] }[process.argv[2]] ?? ['gate', 'drop'];

function sh(cmd, args, { capture = false, env, cwd, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: cwd ?? ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}\n${result.stderr ?? ''}`);
  }
  return result;
}

const psql = (sql) =>
  sh('docker', ['exec', POSTGRES, 'psql', '-U', 'etkin', '-d', 'etkin_load', '-At', '-F', ' | ', '-c', sql], {
    capture: true,
  }).stdout.trim();

function removeContainers() {
  sh('docker', ['rm', '-f', CONTAINERS.api, CONTAINERS.worker], { capture: true, allowFailure: true });
}

async function main() {
  if (sh('docker', ['image', 'inspect', APP_IMAGE], { capture: true, allowFailure: true }).status !== 0) {
    throw new Error(`${APP_IMAGE} not found; build it with: docker compose --profile app build`);
  }

  console.log('\n== seeding etkin_load ==');
  const tsx = createRequire(`${API_DIR}package.json`).resolve('tsx/cli');
  sh(process.execPath, [tsx, '--conditions=source', 'scripts/seed-loadtest.ts'], {
    cwd: API_DIR,
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://etkin:etkin@localhost:5432/etkin_load',
      REDIS_URL: 'redis://localhost:6379/0',
      ...SECRETS,
    },
  });

  console.log('\n== starting API and worker containers ==');
  removeContainers();
  const appEnv = Object.entries({
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    DATABASE_URL: 'postgres://etkin:etkin@postgres:5432/etkin_load',
    DATABASE_POOL_MAX: process.env.LOAD_POOL_MAX ?? '10',
    REDIS_URL: 'redis://redis:6379/0',
    ...SECRETS,
  }).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  console.log(`API database pool: ${process.env.LOAD_POOL_MAX ?? '10'} connections`);
  sh(
    'docker',
    [
      'run',
      '-d',
      '--name',
      CONTAINERS.api,
      '--network',
      NETWORK,
      '-p',
      `127.0.0.1:${HOST_PORT}:3000`,
      ...appEnv,
      APP_IMAGE,
    ],
    { capture: true },
  );
  sh(
    'docker',
    ['run', '-d', '--name', CONTAINERS.worker, '--network', NETWORK, ...appEnv, APP_IMAGE, 'node', 'dist/worker.js'],
    {
      capture: true,
    },
  );
  for (let attempt = 0; ; attempt++) {
    const ready = await fetch(`http://127.0.0.1:${HOST_PORT}/health/ready`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready) break;
    if (attempt > 60) throw new Error('API container never became ready');
    await sleep(500);
  }

  mkdirSync(`${LOADTEST}results`, { recursive: true });
  const failures = [];
  for (const scenario of scenarios) {
    console.log(`\n== k6: ${scenario} ==`);
    const run = sh(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        NETWORK,
        '-v',
        `${LOADTEST}:/scripts`,
        '-e',
        `BASE_URL=http://${CONTAINERS.api}:3000`,
        K6_IMAGE,
        'run',
        '--quiet',
        `--summary-export=/scripts/results/${scenario}-summary.json`,
        `/scripts/${scenario}.js`,
      ],
      { capture: true, allowFailure: true },
    );
    writeFileSync(`${LOADTEST}results/${scenario}.txt`, run.stdout + run.stderr);
    console.log(run.stdout);
    if (run.status !== 0) failures.push(`${scenario} (k6 exit ${run.status}: thresholds or checks failed)`);
  }

  // Give the worker a moment to finish the outbox, then see what the database says.
  await sleep(3000);
  console.log('\n== database after the run ==');
  console.log('check-ins | tickets checked in | ledger entries | outbox pending | badges awarded');
  console.log(
    psql(`select (select count(*) from check_ins),
                 (select count(*) from tickets where status = 'checked_in'),
                 (select count(*) from point_ledger where reason = 'checkin'),
                 (select count(*) from outbox where processed_at is null),
                 (select count(*) from user_badges)`),
  );
  console.log('scan results:');
  console.log(psql('select result, count(*) from scan_attempts group by result order by 2 desc'));
  console.log('drop: issued / capacity | live tickets');
  console.log(
    psql(`select tt.issued_count || ' / ' || tt.capacity, (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status <> 'cancelled')
            from ticket_types tt where tt.name = 'Workshop'`),
  );

  if (failures.length > 0) throw new Error(`failed: ${failures.join(', ')}`);
}

try {
  await main();
  console.log('\nload test passed');
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  removeContainers();
}
