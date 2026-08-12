import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderHistoryPathContext } from '../../../core/providers/types';
import { isPathWithinRoot, isSamePath } from '../../../core/storage/pathContainment';
import {
  resolveExistingJcodeSessionsDir,
  resolveJcodeHomeDir,
  resolveJcodeSessionsDir,
} from '../runtime/JcodePaths';

export function resolveJcodeSessionsDirHint(
  persistedPath: string | null | undefined,
  context?: ProviderHistoryPathContext,
): string | null {
  if (!context) {
    return resolveExistingJcodeSessionsDir(persistedPath);
  }

  const env = context.environment;
  const configuredPath = resolveJcodeSessionsDir(env);
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
  const trustedRoots = [
    resolveJcodeHomeDir(env),
    path.join(home, '.jcode'),
  ];
  const isTrustedHint = !!persistedPath && (
    (!!configuredPath && isSamePath(persistedPath, configuredPath))
    || trustedRoots.some(root => isPathWithinRoot(persistedPath, root))
  );

  return resolveExistingJcodeSessionsDir(
    isTrustedHint ? persistedPath : undefined,
    env,
  );
}
