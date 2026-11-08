import { PROTOCOL_VERSION } from '../shared/protocol.js';

export function resolveServerUrl(input, location) {
  const raw = String(input ?? '').trim();
  if (!raw) return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${raw}`;
  const url = new URL(withScheme);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Server address must be a ws://, wss://, http:// or https:// address.');
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws';
  return url.toString();
}

export class NetClient {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
    this.closedByUser = false;
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  connect({ url, room, name }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = message => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket?.close();
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail(`Timed out connecting to ${url}.`), 8000);
      try {
        this.socket = new WebSocket(url);
      } catch {
        fail(`Could not open a connection to ${url}.`);
        return;
      }
      this.socket.addEventListener('open', () => this.send({ type: 'hello', v: PROTOCOL_VERSION, room, name }));
      this.socket.addEventListener('message', event => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!settled) {
          if (message.type === 'welcome') {
            settled = true;
            clearTimeout(timer);
            resolve(message);
          } else if (message.type === 'error') fail(message.message);
          return;
        }
        this.handlers.get(message.type)?.(message);
      });
      this.socket.addEventListener('close', event => {
        if (!settled) fail(event.reason || `Could not reach a WebCraft server at ${url}.`);
        else if (!this.closedByUser) this.handlers.get('disconnect')?.(event.reason || 'Connection to the server was lost.');
      });
    });
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close() {
    this.closedByUser = true;
    this.socket?.close(1000);
  }
}
