#!/usr/bin/env node
// Helper cross-plataforma pra rodar o parser Python usando o venv de parser/.venv.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const parserDir = resolve(import.meta.dirname, '..', 'parser');
const isWin = process.platform === 'win32';
const venvPy = join(parserDir, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
const py = existsSync(venvPy) ? venvPy : 'python';

if (!existsSync(venvPy)) {
  console.warn(
    `[parser] venv não encontrado em ${venvPy} — usando "python" do PATH.\n` +
      `[parser] Crie o venv:  cd parser && python -m venv .venv && ` +
      `${isWin ? '.venv\\Scripts\\pip' : '.venv/bin/pip'} install -r requirements.txt`,
  );
}

const mode = process.argv[2] ?? 'dev';
const args =
  mode === 'test'
    ? ['-m', 'pytest', '-q']
    : ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', process.env.PARSER_PORT ?? '8100'];

const res = spawnSync(py, args, { cwd: parserDir, stdio: 'inherit' });
process.exit(res.status ?? 1);
