import { App, normalizePath, TFile } from 'obsidian';
import { Font } from '@react-pdf/renderer';

const loadedFonts = new Map<string, Promise<string>>();
let nextFamily = 0;

/** Reject unsupported formats before handing the file to the PDF renderer. */
export function validateFontFile(bytes: ArrayBuffer, path: string): void {
	const view = new DataView(bytes);
	const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
	if (bytes.byteLength < 12) throw new Error(`Font file is empty or invalid: ${path}`);
	const woff = tag(0) === 'wOFF';
	if (!woff && view.getUint32(0) !== 0x00010000 && tag(0) !== 'true') {
		throw new Error(`Unsupported font: ${path}. Use a static TTF or WOFF font, not OTF, WOFF2, or a font collection.`);
	}
	if (woff && bytes.byteLength < 44) throw new Error(`Invalid WOFF font: ${path}`);
	const count = view.getUint16(woff ? 12 : 4);
	const start = woff ? 44 : 12;
	const stride = woff ? 20 : 16;
	if (start + count * stride > bytes.byteLength) throw new Error(`Invalid font table: ${path}`);
	for (let i = 0; i < count; i++) {
		if (tag(start + i * stride) === 'fvar') {
			throw new Error(`Variable font is not supported: ${path}. Choose a static font file for a single weight, such as Regular.`);
		}
	}
}

export async function loadVaultPdfFont(app: App, regularPath: string, boldPath: string): Promise<string | undefined> {
	if (!regularPath.trim()) {
		if (boldPath.trim()) throw new Error('Choose a regular PDF font before setting a bold font.');
		return undefined;
	}
	const findFont = (value: string): TFile => {
		const path = normalizePath(value.trim());
		if (!/\.(ttf|woff)$/i.test(path)) throw new Error(`Choose a .ttf or .woff font file: ${path}`);
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Font file not found in this vault: ${path}`);
		return file;
	};
	const files = [findFont(regularPath), ...(boldPath.trim() ? [findFont(boldPath)] : [])];
	const key = JSON.stringify(files.map(file => [file.path, file.stat.mtime, file.stat.size]));
	const existing = loadedFonts.get(key);
	if (existing) return existing;

	const loading = (async () => {
		const urls: string[] = [];
		try {
			for (const file of files) {
				const bytes = await app.vault.readBinary(file);
				validateFontFile(bytes, file.path);
				urls.push(URL.createObjectURL(new Blob([bytes], { type: file.extension === 'woff' ? 'font/woff' : 'font/ttf' })));
			}
			const family = `ThecapCvCustom${++nextFamily}`;
			Font.register({ family, fonts: urls.map((src, index) => ({ src, fontWeight: index === 0 ? 400 : 700 })) });
			// Load both weights before rendering; React PDF falls back to regular when no bold file is supplied.
			const results = await Promise.allSettled([400, 700].map(fontWeight => Font.load({ fontFamily: family, fontWeight })));
			const failure = results.find(result => result.status === 'rejected');
			if (failure?.status === 'rejected') throw failure.reason;
			return family;
		} catch (error) {
			throw new Error(`Could not load the PDF font. ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			urls.forEach(url => URL.revokeObjectURL(url));
		}
	})();
	loadedFonts.set(key, loading);
	loading.catch(() => loadedFonts.delete(key));
	return loading;
}
