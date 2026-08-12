import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '@/core/execution';
import type { ProviderHost } from '@/core/providers/ProviderHost';

import type { JcodeCommandCatalog } from '../commands/JcodeCommandCatalog';
import {
  type JcodeAcpSessionKernelFactory,
  JcodeExecutionSession,
} from './JcodeExecutionSession';

export interface JcodeExecutionBackendOptions {
  readonly commandCatalog?: Pick<JcodeCommandCatalog, 'setCommandSnapshot'>;
  readonly createKernel?: JcodeAcpSessionKernelFactory;
}

export class JcodeExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'jcode' as const;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: JcodeExecutionBackendOptions = {},
  ) {}

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new JcodeExecutionSession(this.plugin, config, this.options);
  }
}
