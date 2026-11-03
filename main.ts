import { getAllTags, MarkdownView, Plugin, Modal } from 'obsidian';
import React, { StrictMode } from 'react';
import { Root, createRoot } from 'react-dom/client';
import { ReactView } from './ReactView';
import { CvSettings, CvSettingTab, cvNotePath, loadSettings, isCvNote } from './settings';

class CvModal extends Modal {
	root: Root | null = null;

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
		
		// Create container for React
		const reactContainer = contentEl.createDiv();
		this.root = createRoot(reactContainer);

		const markdown = await this.getCurrentMarkdown();
		this.root.render(
			React.createElement(StrictMode, null,
				React.createElement(ReactView, { markdown })
			)
		);
	}

	onClose() {
		this.root?.unmount();
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
			if (this.canPreview()) new CvModal(this.app).open();
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
				if (!checking) new CvModal(this.app).open();
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
