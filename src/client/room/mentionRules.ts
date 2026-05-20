export function isMentionBoundaryChar(char: string | undefined): boolean {
  return !char || /\s|[.,!?;:)\]}]/.test(char);
}

export function isMentionPrefixChar(char: string | undefined): boolean {
  return !char || /\s|\(/.test(char);
}
