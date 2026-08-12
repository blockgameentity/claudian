export interface JcodeProviderState extends Record<string, unknown> {
  nativeConversationContextEstablished?: boolean;
  sessionsDirPath?: string;
}

export function getJcodeState(
  providerState?: unknown,
): JcodeProviderState {
  if (
    providerState === null
    || typeof providerState !== 'object'
    || Array.isArray(providerState)
  ) {
    return {};
  }

  const record = providerState as Record<string, unknown>;
  const parsed = Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => (
        key !== 'sessionsDirPath'
        && key !== 'nativeConversationContextEstablished'
        && value !== undefined
      ),
    ),
  ) as JcodeProviderState;
  const sessionsDirPath = typeof record.sessionsDirPath === 'string'
    ? record.sessionsDirPath.trim()
    : '';
  if (sessionsDirPath) parsed.sessionsDirPath = sessionsDirPath;
  if (typeof record.nativeConversationContextEstablished === 'boolean') {
    parsed.nativeConversationContextEstablished =
      record.nativeConversationContextEstablished;
  }
  return parsed;
}
