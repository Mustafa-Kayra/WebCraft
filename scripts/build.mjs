import { cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
console.log('Static site built in dist/');
