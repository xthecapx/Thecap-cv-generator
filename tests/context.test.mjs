import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildSync } from 'esbuild';

// Exercise the actual plugin and settings code with the Obsidian host API mocked.
const source = buildSync({
  entryPoints: [resolve(dirname(fileURLToPath(import.meta.url)), '../main.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['obsidian', 'react', 'react-dom/client', './ReactView', './pdf-font'],
}).outputFiles[0].text;

class Events {
  listeners = new Map();
  on(name, callback) {
    const callbacks = this.listeners.get(name) || new Set();
    callbacks.add(callback);
    this.listeners.set(name, callbacks);
    return { off: () => callbacks.delete(callback) };
  }
  async emit(name, ...args) {
    for (const callback of this.listeners.get(name) || []) await callback(...args);
  }
}

async function setup(data = null, initialPath = null) {
  const workspace = new Events();
  const vault = new Events();
  const metadataCache = new Events();
  const files = new Map();
  const caches = new Map();
  let view = null;
  let ready;
  let opened = 0;
  const file = path => {
    if (!files.has(path)) files.set(path, { path });
    return files.get(path);
  };
  class MarkdownView {}
  const select = path => { view = path ? Object.assign(new MarkdownView(), { file: file(path) }) : null; };
  select(initialPath);
  workspace.getActiveViewOfType = type => view instanceof type ? view : null;
  workspace.getActiveFile = () => view?.file || null;
  workspace.onLayoutReady = callback => { ready = callback; };
  vault.getAbstractFileByPath = path => files.get(path) || null;
  metadataCache.getFileCache = activeFile => caches.get(activeFile) || null;
  const app = { workspace, vault, metadataCache };
  const ribbon = {
    hidden: false,
    updates: 0,
    toggleClass(name, value) {
      assert.equal(name, 'thecap-cv-ribbon-hidden');
      this.hidden = value;
      this.updates++;
    },
  };
  class Plugin {
    app = app;
    events = [];
    async loadData() { return data; }
    async saveData(settings) { this.saved = JSON.parse(JSON.stringify(settings)); }
    addRibbonIcon(icon, label, callback) { this.clickRibbon = callback; return ribbon; }
    addCommand(command) { this.command = command; }
    addSettingTab(tab) { this.tab = tab; }
    registerEvent(event) { this.events.push(event); }
    unload() { this.events.forEach(event => event.off()); this.onunload(); }
  }
  class PluginSettingTab {
    containerEl = { controls: [], empty() { this.controls = []; } };
  }
  class Setting {
    constructor(container) { this.container = container; }
    setName(name) { this.name = name; return this; }
    setDesc() { return this; }
    addControl(callback) {
      const control = {
        name: this.name,
        options: {},
        addOption(value, label) { this.options[value] = label; return this; },
        setValue(value) { this.value = value; return this; },
        setPlaceholder() { return this; },
        setLimits() { return this; },
        setDynamicTooltip() { return this; },
        onChange(callback) { this.change = callback; return this; },
      };
      callback(control);
      this.container.controls.push(control);
      return this;
    }
    addDropdown(callback) { return this.addControl(callback); }
    addText(callback) { return this.addControl(callback); }
    addSlider(callback) { return this.addControl(callback); }
  }
  const obsidian = {
    Plugin, PluginSettingTab, Setting, MarkdownView,
    Modal: class { open() { opened++; } },
    normalizePath: path => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, ''),
    getAllTags: cache => [
      ...(cache.tags || []).map(item => item.tag),
      ...(cache.frontmatter?.tags || []).map(tag => `#${tag}`),
    ],
  };
  const module = { exports: {} };
  runInNewContext(source, {
    module, exports: module.exports,
    require: name => {
      if (name === 'obsidian') return obsidian;
      if (['react', 'react-dom/client', './ReactView', './pdf-font'].includes(name)) return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const plugin = new module.exports.default();
  await plugin.onload();
  return {
    plugin, ribbon, select, file, files, caches, workspace, metadataCache, vault,
    ready: () => ready(), opened: () => opened,
    assertAvailable(available) {
      assert.equal(ribbon.hidden, !available);
      assert.equal(plugin.command.checkCallback(true), available);
    },
  };
}

test('default supports Markdown notes but not empty tabs or non-Markdown files', async () => {
  const f = await setup();
  f.assertAvailable(false);
  f.select('CV.md');
  await f.workspace.emit('file-open');
  f.assertAvailable(true);
  f.select('CV.pdf');
  await f.workspace.emit('active-leaf-change');
  f.assertAvailable(false);
  f.select(null);
  await f.workspace.emit('active-leaf-change');
  f.assertAvailable(false);
});

test('matches a vault-relative note path, optional extension, and folders exactly', async () => {
  const f = await setup({ cvNoteMode: 'note', cvNotePath: ' Career\\CV ' }, 'Career/CV.md');
  f.assertAvailable(true);
  f.select('Other/CV.md');
  await f.workspace.emit('file-open');
  f.assertAvailable(false);
  f.select('Career/CV.md');
  await f.workspace.emit('active-leaf-change');
  f.assertAvailable(true);
});

test('tags use Obsidian metadata, ignore case, and include nested tags at a slash boundary', async () => {
  const f = await setup({ cvNoteMode: 'tag', cvTag: ' #CV ' }, 'Career/CV.md');
  const activeFile = f.file('Career/CV.md');
  f.assertAvailable(false);
  for (const [cache, expected] of [
    [{ tags: [{ tag: '#cV' }] }, true],
    [{ frontmatter: { tags: ['CV/draft'] } }, true],
    [{ tags: [{ tag: '#cv-old' }] }, false],
    [{ tags: [{ tag: '#career/cv' }] }, false],
    [{ frontmatter: { tags: ['cv'] } }, true],
    [{}, false],
  ]) {
    f.caches.set(activeFile, cache);
    await f.metadataCache.emit('changed', activeFile);
    f.assertAvailable(expected);
  }
});

test('startup metadata resolution and layout readiness refresh visibility', async () => {
  const f = await setup({ cvNoteMode: 'tag', cvTag: 'cv' }, 'CV.md');
  f.caches.set(f.file('CV.md'), { tags: [{ tag: '#cv' }] });
  await f.metadataCache.emit('resolved');
  f.assertAvailable(true);
  f.select(null);
  f.ready();
  f.assertAvailable(false);
});

test('command checks have no side effects and invocation rechecks the active context', async () => {
  const f = await setup({ cvNoteMode: 'note', cvNotePath: 'CV.md' }, 'CV.md');
  assert.equal(f.plugin.command.checkCallback(true), true);
  assert.equal(f.opened(), 0);
  assert.equal(f.plugin.command.checkCallback(false), true);
  assert.equal(f.opened(), 1);
  f.select('Other.md');
  assert.equal(f.plugin.command.checkCallback(false), false);
  f.plugin.clickRibbon();
  assert.equal(f.opened(), 1);
});

test('settings controls persist changes and immediately update note eligibility', async () => {
  const f = await setup(null, 'CV.md');
  f.plugin.tab.display();
  const mode = f.plugin.tab.containerEl.controls[0];
  assert.deepEqual(Object.keys(mode.options), ['all', 'note', 'tag']);
  await mode.change('note');
  f.assertAvailable(false);
  await f.plugin.tab.containerEl.controls.find(control => control.name === 'CV note path').change('CV');
  f.assertAvailable(true);
  assert.equal(f.plugin.saved.cvNotePath, 'CV');
  const reloaded = await setup(f.plugin.saved, 'CV.md');
  reloaded.assertAvailable(true);
});

test('empty configured path or tag does not enable a preview', async () => {
  for (const data of [{ cvNoteMode: 'note', cvNotePath: ' ' }, { cvNoteMode: 'tag', cvTag: '#' }]) {
    const f = await setup(data, 'CV.md');
    f.assertAvailable(false);
  }
});

test('PDF settings persist and legacy settings receive safe defaults', async () => {
  const f = await setup({ pdfFontSize: -5, pdfFontPath: 42 }, 'CV.md');
  assert.equal(f.plugin.settings.pdfFontSize, 12);
  assert.equal(f.plugin.settings.pdfFontPath, '');
  f.plugin.tab.display();
  const controls = f.plugin.tab.containerEl.controls;
  await controls.find(control => control.name === 'PDF text size').change(16);
  await controls.find(control => control.name === 'PDF font file').change('Fonts/Chinese.ttf');
  await controls.find(control => control.name === 'PDF bold font file').change('Fonts/Chinese-Bold.ttf');
  const reloaded = await setup(f.plugin.saved, 'CV.md');
  assert.equal(reloaded.plugin.settings.pdfFontSize, 16);
  assert.equal(reloaded.plugin.settings.pdfFontPath, 'Fonts/Chinese.ttf');
  assert.equal(reloaded.plugin.settings.pdfBoldFontPath, 'Fonts/Chinese-Bold.ttf');
});

test('renaming the selected note updates and persists the configured path', async () => {
  const f = await setup({ cvNoteMode: 'note', cvNotePath: 'Career/CV' }, 'Career/CV.md');
  const note = f.file('Career/CV.md');
  f.files.delete(note.path);
  note.path = 'Career/Resume.md';
  f.files.set(note.path, note);
  await f.vault.emit('rename', note, 'Career/CV.md');
  assert.equal(f.plugin.saved.cvNotePath, 'Career/Resume.md');
  f.assertAvailable(true);
});

test('moving a parent folder updates the note path without matching similar folder names', async () => {
  const f = await setup({ cvNoteMode: 'note', cvNotePath: 'Career/CV.md' }, 'Career/CV.md');
  await f.vault.emit('rename', { path: 'Other' }, 'Car');
  assert.equal(f.plugin.settings.cvNotePath, 'Career/CV.md');
  const note = f.file('Career/CV.md');
  f.files.delete(note.path);
  note.path = 'Archive/Career/CV.md';
  f.files.set(note.path, note);
  await f.vault.emit('rename', { path: 'Archive/Career' }, 'Career');
  assert.equal(f.plugin.saved.cvNotePath, 'Archive/Career/CV.md');
  f.assertAvailable(true);
});

test('deleting the active note disables preview even before its view closes', async () => {
  const f = await setup(null, 'CV.md');
  f.files.delete('CV.md');
  await f.vault.emit('delete');
  f.assertAvailable(false);
});

test('event listeners and late layout callback do not touch the ribbon after unload', async () => {
  const f = await setup(null, 'CV.md');
  f.plugin.unload();
  const updates = f.ribbon.updates;
  f.select(null);
  await f.workspace.emit('active-leaf-change');
  await f.metadataCache.emit('resolved');
  f.ready();
  assert.equal(f.ribbon.updates, updates);
});
