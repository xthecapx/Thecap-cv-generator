import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildSync } from 'esbuild';

const source = buildSync({
  entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../pdf-font.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['obsidian', '@react-pdf/renderer'],
}).outputFiles[0].text;

function fontBytes({ format = 'ttf', variable = false } = {}) {
  const bytes = new ArrayBuffer(format === 'woff' ? 64 : 28);
  const view = new DataView(bytes);
  view.setUint32(0, format === 'woff' ? 0x774f4646 : 0x00010000);
  view.setUint16(format === 'woff' ? 12 : 4, 1);
  view.setUint32(format === 'woff' ? 44 : 12, variable ? 0x66766172 : 0x6e616d65);
  return bytes;
}

function setup({ failLoad = false } = {}) {
  const files = new Map();
  const registrations = [];
  const revoked = [];
  const loads = [];
  let reads = 0;
  class TFile {
    constructor(path, bytes) {
      this.path = path;
      this.bytes = bytes;
      this.extension = path.split('.').pop();
      this.stat = { mtime: 1, size: bytes.byteLength };
    }
  }
  const add = (path, options) => files.set(path, new TFile(path, fontBytes(options)));
  add('Fonts/Regular.ttf');
  add('Fonts/Bold.woff', { format: 'woff' });
  add('Fonts/Variable.ttf', { variable: true });
  const app = { vault: {
    getAbstractFileByPath: path => files.get(path),
    readBinary: async file => { reads++; return file.bytes; },
  } };
  const module = { exports: {} };
  let urls = 0;
  runInNewContext(source, {
    module, exports: module.exports, Blob,
    URL: { createObjectURL: () => `blob:font-${++urls}`, revokeObjectURL: url => revoked.push(url) },
    require: name => {
      if (name === 'obsidian') return { TFile, normalizePath: path => path.replace(/\\/g, '/') };
      if (name === '@react-pdf/renderer') return { Font: {
        register: options => registrations.push(options),
        load: async options => { loads.push(options); if (failLoad) throw new Error('Invalid font data'); },
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { ...module.exports, app, files, registrations, revoked, loads, reads: () => reads };
}

test('default uses Helvetica without accessing vault files', async () => {
  const f = setup();
  assert.equal(await f.loadVaultPdfFont(f.app, '', ''), undefined);
  assert.equal(f.reads(), 0);
  await assert.rejects(f.loadVaultPdfFont(f.app, '', 'Fonts/Bold.woff'), /regular PDF font/);
});

test('loads both weights, reuses cached fonts, and releases temporary blob URLs', async () => {
  const f = setup();
  const family = await f.loadVaultPdfFont(f.app, ' Fonts/Regular.ttf ', 'Fonts/Bold.woff');
  assert.equal(await f.loadVaultPdfFont(f.app, 'Fonts/Regular.ttf', 'Fonts/Bold.woff'), family);
  assert.equal(f.reads(), 2);
  assert.equal(f.registrations.length, 1);
  assert.equal(f.loads.length, 2);
  assert.equal(f.revoked.length, 2);
  assert.equal(f.registrations[0].fonts[1].fontWeight, 700);
  f.files.get('Fonts/Regular.ttf').stat.mtime++;
  assert.notEqual(await f.loadVaultPdfFont(f.app, 'Fonts/Regular.ttf', 'Fonts/Bold.woff'), family);
});

test('registers a single font when bold is omitted', async () => {
  const f = setup();
  await f.loadVaultPdfFont(f.app, 'Fonts/Regular.ttf', '');
  assert.equal(f.registrations[0].fonts.length, 1);
  assert.equal(f.loads[1].fontWeight, 700);
});

test('missing, unsupported and variable fonts produce actionable errors', async () => {
  const f = setup();
  await assert.rejects(f.loadVaultPdfFont(f.app, 'Fonts/Missing.ttf', ''), /not found/);
  await assert.rejects(f.loadVaultPdfFont(f.app, 'Fonts/Font.otf', ''), /ttf or .woff/);
  await assert.rejects(f.loadVaultPdfFont(f.app, 'Fonts/Variable.ttf', ''), /Variable font/);
  assert.throws(() => f.validateFontFile(new ArrayBuffer(2), 'empty.ttf'), /empty or invalid/);
});

test('failed font loading releases URLs and is retryable', async () => {
  const f = setup({ failLoad: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(f.loadVaultPdfFont(f.app, 'Fonts/Regular.ttf', ''), /Invalid font data/);
  }
  assert.equal(f.revoked.length, 2);
  assert.equal(f.reads(), 2);
});
