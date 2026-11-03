import { App, normalizePath, PluginSettingTab, Setting } from 'obsidian';
import type ThecapCvGenerator from './main';

export type CvNoteMode = 'all' | 'note' | 'tag';

export interface CvSettings {
	cvNoteMode: CvNoteMode;
	cvNotePath: string;
	cvTag: string;
	pdfFontSize: number;
	pdfFontPath: string;
	pdfBoldFontPath: string;
}

export function loadSettings(data: Partial<CvSettings> | null): CvSettings {
	return {
		cvNoteMode: data?.cvNoteMode === 'note' || data?.cvNoteMode === 'tag'
			? data.cvNoteMode : 'all',
		cvNotePath: typeof data?.cvNotePath === 'string' ? data.cvNotePath : '',
		cvTag: typeof data?.cvTag === 'string' ? data.cvTag : 'cv',
		pdfFontSize: typeof data?.pdfFontSize === 'number' && Number.isFinite(data.pdfFontSize) && data.pdfFontSize >= 8 && data.pdfFontSize <= 20
			? data.pdfFontSize : 12,
		pdfFontPath: typeof data?.pdfFontPath === 'string' ? data.pdfFontPath : '',
		pdfBoldFontPath: typeof data?.pdfBoldFontPath === 'string' ? data.pdfBoldFontPath : '',
	};
}

export function cvNotePath(value: string): string {
	const path = value.trim();
	if (!path) return '';
	return normalizePath(/\.md$/i.test(path) ? path : `${path}.md`);
}

function normalizeTag(value: string): string {
	return value.trim().replace(/^#/, '').toLowerCase();
}

export function isCvNote(settings: CvSettings, activePath: string | null, tags: string[]): boolean {
	if (!activePath || !/\.md$/i.test(activePath)) return false;
	if (settings.cvNoteMode === 'all') return true;
	if (settings.cvNoteMode === 'note') {
		return cvNotePath(settings.cvNotePath) === activePath;
	}
	const tag = normalizeTag(settings.cvTag);
	return tag !== '' && tags.some(value => {
		const noteTag = normalizeTag(value);
		return noteTag === tag || noteTag.startsWith(`${tag}/`);
	});
}

export class CvSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ThecapCvGenerator) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('CV notes')
			.setDesc('The preview ribbon button and command are available only when a matching Markdown note is active.')
			.addDropdown(dropdown => dropdown
				.addOption('all', 'All Markdown notes')
				.addOption('note', 'A specific note')
				.addOption('tag', 'Notes with a tag')
				.setValue(this.plugin.settings.cvNoteMode)
				.onChange(async value => {
					this.plugin.settings.cvNoteMode = value as CvNoteMode;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.cvNoteMode === 'note') {
			new Setting(containerEl)
				.setName('CV note path')
				.setDesc('Path from the vault root, such as Career/CV.md. The .md extension is optional. An empty path matches no notes.')
				.addText(text => text
					.setPlaceholder('Career/CV.md')
					.setValue(this.plugin.settings.cvNotePath)
					.onChange(async value => {
						this.plugin.settings.cvNotePath = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.cvNoteMode === 'tag') {
			new Setting(containerEl)
				.setName('CV tag')
				.setDesc('A tag in the note or its tags property, such as cv or #career/cv. Includes nested tags and ignores case, like Obsidian search. An empty tag matches no notes.')
				.addText(text => text
					.setPlaceholder('cv')
					.setValue(this.plugin.settings.cvTag)
					.onChange(async value => {
						this.plugin.settings.cvTag = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('PDF text size')
			.setDesc('Base size in points. Headings and smaller text scale together. A note’s font-size property overrides this default. Reopen the preview after changing settings.')
			.addSlider(slider => slider
				.setLimits(8, 20, 1)
				.setValue(this.plugin.settings.pdfFontSize)
				.setDynamicTooltip()
				.onChange(async value => {
					this.plugin.settings.pdfFontSize = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('PDF font file')
			.setDesc('Path to a static TTF or WOFF font in your vault. For Chinese, choose a font with Chinese characters. Leave empty for Helvetica. Fonts load locally and work offline.')
			.addText(text => text
				.setPlaceholder('Fonts/NotoSansSC-Regular.ttf')
				.setValue(this.plugin.settings.pdfFontPath)
				.onChange(async value => {
					this.plugin.settings.pdfFontPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('PDF bold font file')
			.setDesc('Optional bold TTF or WOFF from the same family. Without it, headings use the regular font. Custom fonts use upright text because an italic font is not supplied.')
			.addText(text => text
				.setPlaceholder('Fonts/NotoSansSC-Bold.ttf')
				.setValue(this.plugin.settings.pdfBoldFontPath)
				.onChange(async value => {
					this.plugin.settings.pdfBoldFontPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
