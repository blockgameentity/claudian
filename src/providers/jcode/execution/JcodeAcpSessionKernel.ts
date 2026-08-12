import {
  lstatSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  ProviderSessionConfig,
  ProviderSystemInstructions,
} from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  AcpClientConnection,
  AcpInteractionController,
  AcpJsonRpcTransport,
  type AcpPermissionPresentation,
  type AcpPromptRequest,
  type AcpPromptResponse,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionConfigOption,
  type AcpSessionModelState,
  type AcpSessionModeState,
  type AcpSessionNotification,
  AcpSubprocess,
  type AcpWriteTextFileRequest,
  JsonRpcErrorResponse,
  resolveAcpLoadSessionId,
} from '@/providers/acp';
import { getEnhancedPath } from '@/utils/env';

import { resolveJcodeSessionsDir } from '../runtime/JcodePaths';
import { buildJcodeRuntimeEnv } from '../runtime/JcodeRuntimeEnvironment';

export type JcodeExecutionProfile = 'managed' | 'passive' | 'readonly';

export interface JcodeKernelConnectOptions {
  readonly profile: JcodeExecutionProfile;
  readonly systemInstructions: ProviderSystemInstructions;
}

export interface JcodeNativeSessionInfo {
  readonly sessionId: string;
  readonly sessionsDirPath: string | null;
  readonly configOptions?: AcpSessionConfigOption[] | null;
  readonly models?: AcpSessionModelState | null;
  readonly modes?: AcpSessionModeState | null;
}

export interface JcodeAcpSessionKernelOptions {
  readonly config: ProviderSessionConfig;
  readonly getActiveTurnId: () => string | null;
  readonly onClosed: (error: Error) => void;
  readonly onNotification: (notification: AcpSessionNotification) => void;
  readonly plugin: ProviderHost;
  readonly sessionInstanceId: string;
}

export interface JcodeAcpSessionKernel {
  connect(options: JcodeKernelConnectOptions): Promise<void>;
  openSession(resumeSessionId?: string): Promise<JcodeNativeSessionInfo>;
  setConfigOption(request: Record<string, unknown>): Promise<{
    configOptions?: AcpSessionConfigOption[] | null;
  }>;
  prompt(request: AcpPromptRequest): Promise<Pick<
    AcpPromptResponse,
    'usage' | 'userMessageId'
  > & Partial<Pick<AcpPromptResponse, 'stopReason'>>>;
  cancel(sessionId: string): void;
  dispose(): Promise<void>;
}

export class JcodeSessionMissingError extends Error {
  readonly name = 'JcodeSessionMissingError';

  constructor(
    readonly sessionId: string,
    readonly providerError: unknown,
  ) {
    super(providerError instanceof Error
      ? providerError.message
      : 'Jcode session is missing');
  }
}

export function classifyJcodeSessionLoadError(
  error: unknown,
  attemptedSessionId: string,
): unknown {
  if (
    !(error instanceof JsonRpcErrorResponse)
    || (error.method !== 'session/load' && error.method !== 'loadSession')
  ) {
    return error;
  }

  let data: string;
  try {
    data = JSON.stringify(error.data ?? '');
  } catch {
    data = '';
  }
  const evidence = `${error.message} ${data}`.toLowerCase();
  const explicitlyMissing = (
    /session(?:[_\s-]+)(?:not(?:[_\s-]+)found|missing|unknown)/u.test(evidence)
    || /(?:missing|unknown|not\s+found)[^\n]*session/u.test(evidence)
    || /session[^\n]*does\s+not\s+exist/u.test(evidence)
    || /no\s+such\s+session/u.test(evidence)
  );
  return explicitlyMissing
    ? new JcodeSessionMissingError(attemptedSessionId, error)
    : error;
}

export class DefaultJcodeAcpSessionKernel
  implements JcodeAcpSessionKernel {
  private connection: AcpClientConnection | null = null;
  private process: AcpSubprocess | null = null;
  private transport: AcpJsonRpcTransport | null = null;
  private interactionController: AcpInteractionController | null = null;
  private sessionsDirPath: string | null = null;
  private profile: JcodeExecutionProfile = 'managed';
  private disposed = false;
  private connectPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;

  constructor(private readonly options: JcodeAcpSessionKernelOptions) {}

  connect(options: JcodeKernelConnectOptions): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('Jcode ACP kernel is disposed'));
    }
    if (this.connectPromise) return this.connectPromise;
    if (this.connection) return Promise.resolve();

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    this.connectPromise = pending;
    pending.then(
      () => this.clearConnectPromise(pending),
      () => this.clearConnectPromise(pending),
    );
    void this.connectInternal(options).then(resolve, reject);
    return pending;
  }

  private async connectInternal(
    options: JcodeKernelConnectOptions,
  ): Promise<void> {
    this.profile = options.profile;
    try {
      const cliPath = await this.options.plugin
        .getResolvedProviderCliPath('jcode') ?? 'jcode';
      this.assertNotDisposed();
      const runtimeEnv = buildJcodeRuntimeEnv(
        this.options.plugin.settings,
        cliPath,
      );
      this.assertNotDisposed();
      this.sessionsDirPath = resolveJcodeSessionsDir(runtimeEnv);

      const processEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...runtimeEnv,
        PATH: getEnhancedPath(
          runtimeEnv.PATH,
          path.isAbsolute(cliPath) ? cliPath : undefined,
        ),
      };
      const subprocess = new AcpSubprocess({
        args: [
          'acp',
          '--no-update',
          '--no-selfdev',
          `--cwd=${this.options.config.vaultWorkingDirectory}`,
        ],
        command: cliPath,
        cwd: this.options.config.vaultWorkingDirectory,
        env: processEnv,
      });
      this.process = subprocess;
      this.assertNotDisposed();
      subprocess.start();
      this.assertNotDisposed();

      const transport = new AcpJsonRpcTransport({
        input: subprocess.stdout,
        onClose: (listener) => subprocess.onClose(listener),
        output: subprocess.stdin,
      });
      this.transport = transport;
      this.assertNotDisposed();
      transport.onClose((error) => {
        if (!this.disposed && this.transport === transport) {
          this.options.onClosed(
            error ?? new Error('Jcode ACP transport closed'),
          );
        }
      });

      this.interactionController = new AcpInteractionController({
        getTurnId: this.options.getActiveTurnId,
        interactionPort: this.options.config.interactionPort,
        presentPermission: presentJcodePermission,
        sessionInstanceId: this.options.sessionInstanceId,
      });
      this.assertNotDisposed();
      const connection = new AcpClientConnection({
        clientInfo: {
          name: 'claudian',
          version: this.options.plugin.manifest?.version ?? '0.0.0',
        },
        delegate: {
          fileSystem: this.createFileSystemDelegate(),
          onSessionNotification: (notification) => {
            if (!this.disposed) this.options.onNotification(notification);
          },
          requestPermission: (request) => this.handlePermissionRequest(request),
        },
        transport,
      });
      this.connection = connection;
      this.assertNotDisposed();
      transport.start();
      this.assertNotDisposed();
      await connection.initialize();
      this.assertNotDisposed();
    } catch (error) {
      await this.disposeNativeResources();
      throw error;
    }
  }

  async openSession(resumeSessionId?: string): Promise<JcodeNativeSessionInfo> {
    const connection = this.requireConnection();
    const cwd = this.options.config.vaultWorkingDirectory;
    if (resumeSessionId) {
      let response;
      try {
        response = await connection.loadSession({
          cwd,
          mcpServers: [],
          sessionId: resumeSessionId,
        });
      } catch (error) {
        throw classifyJcodeSessionLoadError(error, resumeSessionId);
      }
      return {
        configOptions: response.configOptions,
        models: response.models,
        modes: response.modes,
        sessionId: resolveAcpLoadSessionId(response, resumeSessionId),
        sessionsDirPath: this.sessionsDirPath,
      };
    }

    const response = await connection.newSession({ cwd, mcpServers: [] });
    return {
      configOptions: response.configOptions,
      models: response.models,
      modes: response.modes,
      sessionId: response.sessionId,
      sessionsDirPath: this.sessionsDirPath,
    };
  }

  setConfigOption(request: Record<string, unknown>): Promise<{
    configOptions?: AcpSessionConfigOption[] | null;
  }> {
    return this.requireConnection().setConfigOption(
      request as Parameters<AcpClientConnection['setConfigOption']>[0],
    );
  }

  prompt(request: AcpPromptRequest): Promise<AcpPromptResponse> {
    return this.requireConnection().prompt(request);
  }

  cancel(sessionId: string): void {
    this.connection?.cancel({ sessionId });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    this.disposePromise = pending;
    void this.disposeInternal().then(resolve, reject);
    return pending;
  }

  private async disposeInternal(): Promise<void> {
    await this.disposeNativeResources();
    await this.connectPromise?.catch(() => undefined);
    await this.disposeNativeResources();
  }

  private async disposeNativeResources(): Promise<void> {
    const interactionController = this.interactionController;
    this.interactionController = null;
    const connection = this.connection;
    this.connection = null;
    const transport = this.transport;
    this.transport = null;
    const subprocess = this.process;
    this.process = null;

    try {
      interactionController?.dispose();
    } catch {
      // Continue closing native resources.
    }
    try {
      connection?.dispose();
    } catch {
      // Continue closing native resources.
    }
    try {
      transport?.dispose();
    } catch {
      // Continue closing native resources.
    }
    try {
      await subprocess?.shutdown();
    } catch {
      // Resource cleanup is best effort after ownership has been detached.
    }
  }

  private clearConnectPromise(pending: Promise<void>): void {
    if (this.connectPromise === pending) this.connectPromise = null;
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('Jcode ACP kernel is disposed');
  }

  private createFileSystemDelegate(): {
    readTextFile?: (request: AcpReadTextFileRequest) => Promise<{ content: string }>;
    writeTextFile?: (
      request: AcpWriteTextFileRequest,
    ) => Promise<Record<string, never>>;
  } | undefined {
    if (this.profile === 'passive') return undefined;
    const readTextFile = async (
      request: AcpReadTextFileRequest,
    ): Promise<{ content: string }> => {
      const resolvedPath = this.profile === 'readonly'
        ? resolveJcodeReadPath(
          this.options.config.vaultWorkingDirectory,
          request.path,
        )
        : resolveManagedPath(
          this.options.config.vaultWorkingDirectory,
          request.path,
        );
      const content = await fs.readFile(resolvedPath, 'utf8');
      if (request.line === undefined && request.limit === undefined) {
        return { content };
      }
      const lines = content.split(/\r?\n/);
      const start = Math.max(0, (request.line ?? 1) - 1);
      const limit = request.limit;
      const end = limit === undefined || limit === null
        ? lines.length
        : start + Math.max(0, limit);
      return { content: lines.slice(start, end).join('\n') };
    };
    if (this.profile === 'readonly') return { readTextFile };
    return {
      readTextFile,
      writeTextFile: async (request) => {
        const resolvedPath = resolveManagedPath(
          this.options.config.vaultWorkingDirectory,
          request.path,
        );
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, request.content, 'utf8');
        return {};
      },
    };
  }

  private handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (this.profile !== 'managed') {
      return Promise.resolve(selectDeniedPermission(request));
    }
    return this.interactionController?.requestPermission(request)
      ?? Promise.resolve({ outcome: { outcome: 'cancelled' } });
  }

  private requireConnection(): AcpClientConnection {
    if (!this.connection) throw new Error('Jcode ACP kernel is not connected');
    return this.connection;
  }
}

export function resolveJcodeReadPath(
  workspaceRoot: string,
  rawPath: string,
): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, rawPath);
  if (!isPathWithinRoot(resolved, root)) {
    throw new Error('Jcode read access is limited to the current workspace');
  }

  const canonicalRoot = resolveCanonicalPath(root);
  const canonicalPath = resolveCanonicalPath(resolved);
  if (!isPathWithinRoot(canonicalPath, canonicalRoot)) {
    throw new Error('Jcode read access is limited to the current workspace');
  }
  return canonicalPath;
}

export function presentJcodePermission(
  request: AcpRequestPermissionRequest,
  input: Readonly<Record<string, unknown>>,
): AcpPermissionPresentation {
  const permissionId = normalizePermissionId(request.toolCall.title);
  const blockedPath = extractPermissionPath(input, request.toolCall.locations);

  switch (permissionId) {
    case 'bash':
      return {
        decisionReason: 'Command execution permission required',
        description: 'Jcode wants to run a shell command.',
        toolName: 'bash',
      };
    case 'browser':
      return {
        decisionReason: 'Browser automation permission required',
        description: 'Jcode wants to drive a browser automation session.',
        toolName: 'browser',
      };
    case 'edit':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'File write permission required',
        description: blockedPath
          ? 'Jcode wants to modify this file.'
          : 'Jcode wants to apply file changes.',
        toolName: 'edit',
      };
    case 'external_directory':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'Path is outside the session working directory',
        description: blockedPath
          ? 'Jcode wants to access a path outside the working directory.'
          : 'Jcode wants to access files outside the working directory.',
        toolName: 'External Directory',
      };
    case 'glob':
      return {
        description: 'Jcode wants to scan file paths with a glob pattern.',
        toolName: 'glob',
      };
    case 'grep':
      return {
        description: 'Jcode wants to search file contents with a pattern.',
        toolName: 'grep',
      };
    case 'memory':
    case 'memory_remember':
    case 'memory_recall':
    case 'memory_search':
      return {
        description: 'Jcode wants to read or update its persistent memory.',
        toolName: 'memory',
      };
    case 'plan':
      return {
        description: 'Jcode wants to update the shared task plan.',
        toolName: 'plan',
      };
    case 'question':
      return {
        description: 'Jcode wants to ask you a direct question before continuing.',
        toolName: 'Ask Question',
      };
    case 'read':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? 'Jcode wants to read this path.'
          : 'Jcode wants to read project files.',
        toolName: 'read',
      };
    case 'session_search':
      return {
        description: 'Jcode wants to search previous agent sessions.',
        toolName: 'session_search',
      };
    case 'skill':
      return {
        description: 'Jcode wants to load a skill into the current session.',
        toolName: 'skill',
      };
    case 'task':
      return {
        description: 'Jcode wants to spawn a subagent task.',
        toolName: 'task',
      };
    case 'todo':
    case 'todowrite':
      return {
        description: 'Jcode wants to update the shared task list.',
        toolName: 'todowrite',
      };
    case 'webfetch':
      return {
        description: 'Jcode wants to fetch content from a URL.',
        toolName: 'webfetch',
      };
    case 'websearch':
      return {
        description: 'Jcode wants to search the web.',
        toolName: 'websearch',
      };
    case 'write':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'File write permission required',
        description: blockedPath
          ? 'Jcode wants to write this file.'
          : 'Jcode wants to create or overwrite a file.',
        toolName: 'write',
      };
    default:
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? `Jcode wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
          : `Jcode wants permission to use ${formatPermissionLabel(permissionId)}.`,
        toolName: formatPermissionLabel(permissionId),
      };
  }
}

function normalizePermissionId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || 'tool';
}

function extractPermissionPath(
  input: Readonly<Record<string, unknown>>,
  locations: ReadonlyArray<{ path: string }> | null | undefined,
): string | undefined {
  const candidateKeys = ['filepath', 'filePath', 'path', 'parentDir'];
  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const locationPath = locations?.find((location) => location.path.trim())?.path;
  return locationPath?.trim() || undefined;
}

function formatPermissionLabel(permissionId: string): string {
  return permissionId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function resolveManagedPath(workspaceRoot: string, rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceRoot, rawPath);
}

function resolveCanonicalPath(
  targetPath: string,
  resolvingLinks = new Set<string>(),
): string {
  let current = path.resolve(targetPath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.resolve(realpathSync.native(current), ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      let linkTarget: string | null = null;
      try {
        if (lstatSync(current).isSymbolicLink()) {
          linkTarget = readlinkSync(current);
        }
      } catch (lstatError) {
        if (!isMissingPathError(lstatError)) throw lstatError;
      }
      if (linkTarget !== null) {
        if (resolvingLinks.has(current)) {
          throw new Error(`Circular symbolic link: ${current}`, {
            cause: error,
          });
        }
        const nextResolvingLinks = new Set(resolvingLinks);
        nextResolvingLinks.add(current);
        const resolvedTarget = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(path.dirname(current), linkTarget);
        return path.resolve(
          resolveCanonicalPath(resolvedTarget, nextResolvingLinks),
          ...missingSegments,
        );
      }
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    )
  );
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function selectDeniedPermission(
  request: AcpRequestPermissionRequest,
): AcpRequestPermissionResponse {
  const rejected = request.options.find(({ kind }) => kind === 'reject_once')
    ?? request.options.find(({ kind }) => kind === 'reject_always');
  return rejected
    ? {
      outcome: {
        optionId: rejected.optionId,
        outcome: 'selected',
      },
    }
    : { outcome: { outcome: 'cancelled' } };
}
