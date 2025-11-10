export interface CardPayload {
  msg_type: 'interactive';
  card: Record<string, unknown>;
}
