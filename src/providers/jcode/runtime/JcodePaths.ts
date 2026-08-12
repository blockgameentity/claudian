import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const JCODE_HOME_DIR_NAME = '.jcode';
const SESSIONS_DIR_NAME = 'sessions';

export function resolveJcodeHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.JCODE_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }

  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  return path.join(home, JCODE_HOME_DIR_NAME);
}

export function resolveJcodeSessionsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveJcodeHomeDir(env), SESSIONS_DIR_NAME);
}

export function resolveExistingJcodeSessionsDir(
  preferredPath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const preferred = preferredPath?.trim();
  if (preferred) {
    if (fs.existsSync(preferred)) {
      return preferred;
    }
  }

  const resolved = resolveJcodeSessionsDir(env);
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  return preferred ?? resolved;
}

export function resolveJcodeSessionFilePath(
  sessionId: string,
  sessionsDirPath: string,
): string {
  return path.join(sessionsDirPath, `${sessionId}.json`);
}
