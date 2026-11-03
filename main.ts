import { App, getAllTags, MarkdownView, Plugin, Modal } from 'obsidian';
import React, { StrictMode } from 'react';
import { Root, createRoot } from 'react-dom/client';
import { ReactView } from './ReactView';
import { CvSettings, CvSettingTab, cvNotePath, loadSettings, isCvNote } from './settings';
import { loadVaultPdfFont } from './pdf-font';

class CvModal extends Modal {
	root: Root | null = null;
	private closed = false;

	constructor(app: App, private settings: CvSettings) {
		super(app);
	}

	async getCurrentMarkdown(): Promise<string> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return '';
		
		const content = await this.app.vault.cachedRead(activeFile);
		return content;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cv-preview-modal');
		
		contentEl.createEl('p', { text: 'Loading PDF preview…' });
		try {
			const [markdown, fontFamily] = await Promise.all([
				this.getCurrentMarkdown(),
				loadVaultPdfFont(this.app, this.settings.pdfFontPath, this.settings.pdfBoldFontPath),
			]);
			if (this.closed) return;
			contentEl.empty();
			this.root = createRoot(contentEl.createDiv());
			this.root.render(
				React.createElement(StrictMode, null,
					React.createElement(ReactView, { markdown, options: { fontFamily, fontSize: this.settings.pdfFontSize } })
				)
			);
		} catch (error) {
			if (this.closed) return;
			contentEl.empty();
			contentEl.createEl('p', { text: error instanceof Error ? error.message : 'Could not open the PDF preview.' });
			contentEl.createEl('p', { text: 'Check the PDF font paths in the plugin settings, then reopen the preview.' });
		}
	}

	onClose() {
		this.closed = true;
		this.root?.unmount();
		this.root = null;
		const { contentEl } = this;
		contentEl.empty();
	}
}

export default class ThecapCvGenerator extends Plugin {
	settings: CvSettings = loadSettings(null);
	private ribbonIcon: HTMLElement | null = null;

	async onload() {
		this.settings = loadSettings(await this.loadData());
		this.addSettingTab(new CvSettingTab(this.app, this));
		this.ribbonIcon = this.addRibbonIcon('pdf-file', 'Preview curriculum', () => {
			if (this.canPreview()) new CvModal(this.app, { ...this.settings }).open();
		});
		this.updateRibbonVisibility();
		this.app.workspace.onLayoutReady(() => this.updateRibbonVisibility());
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateRibbonVisibility()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.updateRibbonVisibility()));
		this.registerEvent(this.app.metadataCache.on('changed', file => {
			if (file === this.app.workspace.getActiveViewOfType(MarkdownView)?.file) {
				this.updateRibbonVisibility();
			}
		}));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.updateRibbonVisibility()));
		this.registerEvent(this.app.vault.on('delete', () => this.updateRibbonVisibility()));
		this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
			const path = cvNotePath(this.settings.cvNotePath);
			if (path && (path === oldPath || path.startsWith(`${oldPath}/`))) {
				this.settings.cvNotePath = file.path + path.slice(oldPath.length);
				await this.saveSettings();
			} else {
				this.updateRibbonVisibility();
			}
		}));

		this.addCommand({
			id: 'thecap-cv-generator-preview',
			name: 'Open curriculum preview',
			checkCallback: checking => {
				if (!this.canPreview()) return false;
				if (!checking) new CvModal(this.app, { ...this.settings }).open();
				return true;
			}
		});
	}

	canPreview(): boolean {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		// A view can briefly retain a deleted file until its leaf has closed.
		const activePath = file && this.app.vault.getAbstractFileByPath(file.path) === file ? file.path : null;
		const cache = file ? this.app.metadataCache.getFileCache(file) : null;
		return isCvNote(this.settings, activePath, cache ? getAllTags(cache) || [] : []);
	}

	updateRibbonVisibility(): void {
		this.ribbonIcon?.toggleClass('thecap-cv-ribbon-hidden', !this.canPreview());
	}

	async saveSettings(): Promise<void> {
		this.updateRibbonVisibility();
		await this.saveData(this.settings);
	}

	onunload() {
		this.ribbonIcon = null;
	}
}
