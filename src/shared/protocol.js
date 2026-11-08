export const PROTOCOL_VERSION = 1;
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 200;

export function sanitizeRoom(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

export function sanitizeName(value) {
  return String(value ?? '').replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
}

export function sanitizeChat(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT_LENGTH);
}
