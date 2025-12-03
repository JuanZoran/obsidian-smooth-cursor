import { Editor, MarkdownFileInfo, MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian';
import { SmoothCursorSettingTab } from 'src/setting';
import { Editor as cmEditor } from "codemirror"

interface cmEditorExtention extends cmEditor {
	coordsForChar(offset: number): { left: number; top: number; right: number; bottom: number };
	domAtPos(offset: number): { node: Node; offset: number; precise: boolean; };
	coordsAtPos(pos: number): { left: number; top: number; right: number; bottom: number };
	dom: HTMLElement;
}

interface SmoothCursorPluginSettings {
	/** 拖尾步数，越大越慢 */
	trailStep: number;

	/** 是否启用拖尾效果 */
	enableTrail: boolean;

	// /** 光标颜色 */
	// cursorColor: string;

	/** 拖尾颜色 */
	trailColor: string;
	trailColorDark: string;

	// /** 光标闪烁速度 */
	// blinkSpeed: number;
}

const DEFAULT_SETTINGS: SmoothCursorPluginSettings = {
	trailStep: 30,
	enableTrail: true,
	// cursorColor: "#ffffff",
	trailColor: "#78dce8",
	trailColorDark: "#78dce8",
	// blinkSpeed: 1
};

export default class SmoothCursorPlugin extends Plugin {

	// ----- 暴露的设置 -----
	setting: SmoothCursorPluginSettings;

	// ----- 私有变量 -----

	curEditor: MarkdownFileInfo | null;

	fileIndex: { [key: string]: number } = {};

	editorDom: { [key: number]: HTMLElement } = {};
	observer: MutationObserver | null = null;
	settingObserver: MutationObserver | null = null;

	canvas: { [key: number]: HTMLCanvasElement } = {};
	ctx: { [key: number]: CanvasRenderingContext2D | null } = {};

	cursor: { [key: number]: HTMLElement } = {};
	vimText: { [key: number]: HTMLElement } = {};

	isMouseDown: boolean = false;
	mouseForX: { down: number, move: number } = { down: 0, move: 0 };
	mouseForY: { down: number, move: number } = { down: 0, move: 0 };
	mouseMoveTaget: { down: HTMLElement, move: HTMLElement };

	customStyle: HTMLStyleElement;
	vimStyle: HTMLStyleElement;

	isScroll: boolean = false;

	focus: boolean = true;

	closeSettings: boolean = false;

	lastRect: { [key: number]: { x: number, y: number, width: number, height: number } } = {};

	private events: WeakMap<HTMLElement, Partial<{
		[K in keyof HTMLElementEventMap]: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any;
	}>> = new WeakMap();

	// ----- trail ------

	lastPos: { x: number, y: number, height: number, width: number }[] = [{ x: 0, y: 0, height: 0, width: 0 }];

	lastPosForChangeFile: { x: number, y: number, height: number, width: number }[] = [{ x: 0, y: 0, height: 0, width: 0 }];

	rectangle: { x: number, y: number, dirX: number, dirY: number, extTarget: number, extOrigin: number }[] =
		[{ x: 0, y: 0, dirX: 0, dirY: 0, extTarget: 0, extOrigin: 0 }];

	trailCount: number[] = [];

	isFirstTrail: { [key: number]: boolean } = {};

	async onload() {

		console.log("Smooth Cursor loaded");
		// 设置默认设置
		await this.loadSettings();

		this.addSettingTab(new SmoothCursorSettingTab(this.app, this))

		this.app.workspace.onLayoutReady(() => {

			let files = this.getAllOpenFilePaths();
			let firstFile = this.app.workspace.getActiveFile();
			if (firstFile) {
				this.fileIndex[firstFile.path] = Object.keys(this.fileIndex).length;;
				this.isFirstTrail[0] = true;
			}

			this.registerEvent(this.app.workspace.on("file-open", (file) => {

				// console.log("打开文件", file)

				//切换文件的时候清除光标和画布
				if (file !== null) {

					// let curFiles = this.getAllOpenFilePaths();
					// let diff = files.filter(x => !curFiles.includes(x));

					for (let i = 0; i < files.length; i++) {
						// console.log("关闭文件", this.fileIndex, files[i])
						this.uninit(this.fileIndex[files[i]]);
						delete this.fileIndex[files[i]];
					}

					files = this.getAllOpenFilePaths();


					this.fileIndex[file.path] = Object.keys(this.fileIndex).length;

					// this.isFirstTrail[this.fileIndex[file.path]] = true;
					//增加点延迟，防止动画事件未结束
					this.delayedFrames(() => {
						this.init(this.fileIndex[file.path]);
					}, 10)
					// console.log("重新初始化")
					} else {
						this.lastPosForChangeFile = [{ x: 0, y: 0, height: 0, width: 0 }];
						this.events = new WeakMap();
						this.uninit(0);

				}
			}));

			// this.registerEvent(this.app.workspace.on("active-leaf-change", (e) => {
			// 	console.log(e.)
			// }));

			// console.log("打开文件")

			this.init(0);
		});
	}

	onunload() {
		for (let i = 0; i < Object.keys(this.cursor).length; i++) {
			this.cursor[i]?.remove();
		}
		for (let i = 0; i < Object.keys(this.canvas).length; i++) {
			this.canvas[i]?.remove();
		}

		this.stopObserving();
		console.log("Smooth Cursor unloaded")
	}

	// 获取所有打开的 Markdown 页面路径
	getAllOpenFilePaths(): string[] {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		const paths: string[] = [];

		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) {
				paths.push(view.file.path);
			}
		}

		return paths;
	}

	getVimState(i: number): { isVim: boolean; isNormal: boolean } {
		const editorEl = this.editorDom[i];
		const isVim = document.querySelector('.cm-vimCursorLayer') !== null;
		const isNormal = isVim && !!editorEl && (editorEl.classList.contains("cm-fat-cursor") || !!editorEl.querySelector(".cm-fat-cursor"));
		return { isVim, isNormal };
	}

	isVisible(elem: HTMLElement) {
		// 递归检查元素和所有父级是否都可见
		return !!(elem.offsetParent);
	}

	/**
	 * 监听事件 防止重复监听
	 */
	eventRegister<K extends keyof HTMLElementEventMap>(node: HTMLElement, key: K, func: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any) {
		let eventMap = this.events.get(node);
		if (!eventMap) {
			eventMap = {};
			this.events.set(node, eventMap);
		}

		let event = eventMap[key];
		if (!event) {
			event = func as typeof event;
			eventMap[key] = event;
		}

		this.registerDomEvent(node, key, event as (this: HTMLElement, ev: HTMLElementEventMap[K]) => any);
	}

	uninit(i: number) {
		// console.log("反初始化");
		this.cursor[i]?.remove();
		this.canvas[i]?.remove();

		// console.log("移除光标和画布", this.cursor, this.cursor[i], i)

		this.isFirstTrail[i] = true;
		// this.cursor.splice(i, 1);
		// this.canvas.splice(i, 1);
		delete this.cursor[i];
		delete this.canvas[i];
		delete this.ctx[i];
		delete this.lastRect[i];
		this.trailCount[i] = 0;

		this.stopObserving();
	}

	init(i: number) {
		// console.log("初始化")
		let ele = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf.view.containerEl.querySelector('.cm-editor') as HTMLElement;
		this.editorDom[i] = ele;
		// let eles = document.querySelectorAll('.cm-editor');
		// for (let i = 0; i < eles.length; i++) {
		// 	let el = eles[i] as HTMLElement;
		// 	if (this.isVisible(el)) {
		// 		this.editorDom.push(el);
		// 		this.test = el.getBoundingClientRect();
		// 		break;
		// 	}
		// }

		if (!ele) {
			console.error("未打开文档");
			return;
		}

		// this.isInited = true;

		// 创建一个自定义光标
		// for (let i = 0; i < this.editorDom.length; i++) {
		// 	let cursor = this.app.workspace.containerEl.createDiv({ cls: "smooth-cursor-busyo" });
		// 	this.cursor.push(cursor);
		// 	cursor.id = "smooth-cursor-busyo-" + i;
		// 	this.editorDom[i].appendChild(cursor);

		// 	let vimText = this.app.workspace.containerEl.createDiv();
		// 	this.vimText.push(vimText);
		// 	cursor.appendChild(vimText);
		// 	vimText.classList.add("vim-text");
		// }

		let cursor = this.app.workspace.containerEl.createDiv({ cls: "smooth-cursor-busyo" });
		this.cursor[i] = cursor;
		cursor.id = "smooth-cursor-busyo-" + i;
		this.editorDom[i].appendChild(cursor);

		let vimText = this.app.workspace.containerEl.createDiv();
		this.vimText[i] = vimText;
		cursor.appendChild(vimText);
		vimText.classList.add("vim-text");

		//延迟10帧，防止在样式加载完成前执行
		this.delayedFrames(() => {
			// 获取所有的 style 标签
			const styles = document.querySelectorAll('style');

			// 要查找的特定 CSS 规则（例如，查找包含 'color' 的规则）
			const ruleName = 'smooth-cursor-busyo';
			const vimText = 'vim-text';

			for (let index = 0; index < styles.length; index++) {
				let style = styles[index];
				let cssText = style.textContent as string;

				// 检查 CSS 内容是否包含特定的规则
				if (cssText.includes(ruleName)) {
					this.customStyle = style;
					// break;
				}

				if (cssText.includes(vimText)) {
					this.vimStyle = style;
				}
			}
		}, 10);


		if (!this.setting.enableTrail) {
			// for (let i = 0; i < this.cursor.length; i++) {
			// 	this.cursor[i].addClass("show");
			// }
			this.cursor[i]?.addClass("show");
		}

		// for (let i = 0; i < this.editorDom.length; i++) {


		// }

		this.createTrail(i);

		this.eventRegister(this.editorDom[i], "mousedown", (evt) => {

			this.isMouseDown = true;
			this.mouseForX.down = evt.clientX;
			this.mouseMoveTaget = { down: evt.target as HTMLElement, move: evt.target as HTMLElement };

			this.mouseForY.down = this.updateCursor(i)?.y || 0;
		});

		let delay = 20;
		let lastTime = 0;
		let curTime = 0;
		this.eventRegister(this.editorDom[i], "mousemove", (evt) => {
			curTime = Date.now();
			if (this.isMouseDown && curTime - lastTime > delay) {
				this.mouseMoveTaget.move = evt.target as HTMLElement;

				this.mouseForX.move = evt.clientX;
				this.mouseForY.move = this.updateCursor(i)?.y || 0;

				lastTime = curTime;
			}
		});

		this.eventRegister(this.editorDom[i], "mouseup", () => {

			this.isMouseDown = false;
			this.updateCursor(i);
		});

		["keydown", "keyup", "compositionstart", "compositionupdate", "compositionend"].forEach((evtName) => {
			this.eventRegister(this.editorDom[i], evtName as keyof HTMLElementEventMap, () => {
				this.updateCursor(i);
			});
		});

		this.registerDomEvent(document, "selectionchange", () => {
			this.updateCursor(i);
		});

		this.registerEvent(this.app.workspace.on("resize", () => {
			// this.isResize = true;
			const rect = this.editorDom[i]?.getBoundingClientRect();
			if (this.canvas[i] && rect) {
				this.canvas[i].width = rect.width;
				this.canvas[i].height = rect.height;
			}

			this.isScroll = true;
			this.updateCursor(i);
		}));

		// let scroller = document.querySelector('.cm-scroller');

		const scroller = this.editorDom[i].querySelector(".cm-scroller") as HTMLElement | null;
		if (scroller) {
			this.eventRegister(scroller, "scroll", () => {
				this.isScroll = true;
				this.updateCursor(i);
			});
		}

		this.lastPos = this.lastPosForChangeFile;

		this.startObserving(i);

		//检测不在编辑器内
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			// console.log(leaf?.view.getViewType());
			if (leaf && leaf.view.containerEl.contains(this.editorDom[i])) {
				this.focus = true;
				document.body.addClass("caret-hide");
				this.cursor[i]?.addClass("show");
			} else {
				this.focus = false;
				document.body.removeClass("caret-hide");
				this.cursor[i]?.removeClass("show");
			}
		}));


		this.updateCursor(i);

		//默认隐藏系统光标
		document.body.addClass("caret-hide");

	}


	/**
	 * 更新光标坐标
	 */
	updateCursor(i: number) {
		if (!this.cursor[i] || !this.customStyle) {
			return;
		}

		if (this.curEditor != this.app.workspace.activeEditor) {
			this.curEditor = this.app.workspace.activeEditor;
		}

		//判断点击的是文件名还是正文
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			this.focus = false;
			this.cursor[i]?.removeClass("show");
			return;
		}

		let node = selection.getRangeAt(0).commonAncestorContainer;
		let isTitle = false;
		if (node.nodeType === Node.ELEMENT_NODE) {
			// 尝试获取元素节点的右下角
			isTitle = (node as HTMLElement).classList.contains("inline-title");
		} else if (node.nodeType === Node.TEXT_NODE) {
			isTitle = (node.parentElement as HTMLElement).classList.contains("inline-title");
		}

		this.closeSettings = false;

		let pos = this.getCursorPosition(i, isTitle);

		// console.log("pos => ", pos)

		//如果返回的位置为无效位置，不更新光标
		if (pos.x == -1 && pos.y == -1) {
			this.focus = false;
			this.cursor[i]?.removeClass("show");
			return;
		} else {
			this.focus = true;
			this.cursor[i]?.addClass("show");
		}

		// console.log("坐标", pos)

		const scrollX = window.scrollX || document.documentElement.scrollLeft;
		const scrollY = window.scrollY || document.documentElement.scrollTop;

		if (this.isScroll) {
			this.cursor[i].addClass("noTrans");
		} else {
			this.cursor[i].removeClass("noTrans");
		}

		//vim 模式下方块光标文本更新（标题处保持条状光标）
		const { isNormal } = this.getVimState(i);
		if (isNormal && !isTitle) {
			let str = this.getNextCharAfterCursor(i, isTitle);
			if (str) {
				this.vimText && (this.vimText[i].textContent = str.text);
				this.vimStyle.textContent = (this.vimStyle.textContent as string).replace(/(--vim-font-size:\s*[^;]+;)/, `--vim-font-size: ${str.size};`);
			} else {
				this.vimText && (this.vimText[i].textContent = "");
			}
		} else {
			this.vimText && (this.vimText[i].textContent = "");
		}

		// 修改坐标，该部分样式为自动计算，仅用于坐标变化
		//change position, the style is automatically calculated and is used only for coordinate changes
		let content = (this.customStyle.textContent as string).replace(/(--cursor-x:\s*[^;]+;)/, `--cursor-x: ${pos.x + scrollX};`);
		content = content.replace(/(--cursor-y:\s*[^;]+;)/, `--cursor-y: ${pos.y + scrollY};`);
		content = content.replace(/(--cursor-height:\s*[^;]+;)/, `--cursor-height: ${pos.height};`);
		content = content.replace(/(--cursor-width:\s*[^;]+;)/, `--cursor-width: ${pos.width};`);

		this.customStyle.textContent = content;

		if (this.setting.enableTrail && !this.isScroll) {
			if (this.lastPos[i] && (this.lastPos[i].x != pos.x || this.lastPos[i].y != pos.y)) {
				// console.log("更新轨迹")
				this.updateTrail(i, this.lastPos[i].x, this.lastPos[i].y, pos.x, pos.y, pos.height, this.lastPos[i].height);
			}
		}

		if (this.setting.enableTrail && this.cursor[i].hasClass("noAni")) {
			this.cursor[i].removeClass("noAni");
		} else if (!this.setting.enableTrail) {
			this.cursor[i].addClass("noAni");
			setTimeout(() => {
				this.cursor[i]?.removeClass("noAni");
			}, 80);
		}

		this.lastPos[i] = pos;
		if (this.editorDom[i].getBoundingClientRect().width !== 0) {

			this.lastPosForChangeFile[i] = pos;
		}
		// console.log("光标位置", pos)

		this.isScroll = false;

		return pos;
	}

	getNextCharAfterCursor(i: number, isTitle?: boolean) {
		if (isTitle) {
			return null;
		} else {
			const editor = this.app.workspace.activeEditor?.editor;
			const cmView = (editor as Editor & { cm: cmEditor })?.cm as cmEditorExtention; // CM6 的 EditorView 实例
			if (cmView && editor) {
				const cursor = editor.getCursor();
				const doc = cmView.state.doc;
				const totalLines = doc.lines;

				if (cursor.line + 1 >= totalLines) {
					// 最后一行，没有下一字符
				} else {
					const nextLine = doc.line(cursor.line + 1);
					const safeCh = Math.min(cursor.ch, nextLine.length);
					const pos = nextLine.from + safeCh;

						if (pos < nextLine.to) {
							const char = doc.sliceString(pos, pos + 1);

							const coords = cmView.coordsAtPos(pos);
						if (coords) {
							const cursorNode = document.elementFromPoint(coords.left, coords.top);
							if (cursorNode) {
								const fontSize = window.getComputedStyle(cursorNode).fontSize;
								return {
									text: char,
									size: fontSize
								};
							}
						}
					}
				}
			}
			// fallback: end-of-line或无法获取字符时使用空格占位，避免退化为细条
			const selection = window.getSelection();
			let fontSize = "16px";
			if (selection?.focusNode) {
				const node = selection.focusNode.nodeType === Node.TEXT_NODE
					? (selection.focusNode.parentElement as Element | null)
					: (selection.focusNode as Element | null);
				if (node) {
					fontSize = window.getComputedStyle(node).fontSize || fontSize;
				}
			} else {
				const cmContent = this.editorDom[i]?.querySelector(".cm-content") as HTMLElement | null;
				if (cmContent) fontSize = window.getComputedStyle(cmContent).fontSize || fontSize;
			}
			return { text: "\u00A0", size: fontSize };
		}
	}

	getTitleCharAfterCursor(selection: Selection) {
		const range = selection.getRangeAt(0);
		const node = range.startContainer;
		let fontSize = "16px";

		if (node.nodeType === Node.TEXT_NODE) {
			const textNode = node as Text;
			fontSize = window.getComputedStyle(textNode.parentElement as Element).fontSize;
			if (range.startOffset < textNode.length) {
				return { text: textNode.data[range.startOffset], size: fontSize };
			}
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			fontSize = window.getComputedStyle(node as Element).fontSize;
		}

		// 使用不间断空格保证宽度
		return { text: "\u00A0", size: fontSize };
	}

	getSelectionFontSize(selection: Selection | null, i: number): number {
		let fontSize = 16;
		let el: Element | null = null;

		if (selection?.focusNode) {
			if (selection.focusNode.nodeType === Node.TEXT_NODE) {
				el = selection.focusNode.parentElement;
			} else if (selection.focusNode instanceof Element) {
				el = selection.focusNode;
			}
		}

		if (!el) {
			const cmContent = this.editorDom[i]?.querySelector(".cm-content") as HTMLElement | null;
			el = cmContent;
		}

		if (el) {
			const fs = window.getComputedStyle(el).fontSize;
			const num = parseFloat(fs);
			if (!isNaN(num)) {
				fontSize = num;
			}
		}

		return fontSize;
	}

	resolveCursorWidth(rectWidth: number, selection: Selection | null, i: number) {
		const fontSize = this.getSelectionFontSize(selection, i);
		const minWidth = 3;
		const maxWidth = fontSize * 2; // allow double-width glyphs but clamp to avoid full-line width

		if (rectWidth > 0) {
			return Math.max(minWidth, Math.min(rectWidth, maxWidth));
		}

		return Math.max(minWidth, fontSize * 0.6);
	}

	getCollapsedSelectionRect(selection: Selection): DOMRect | null {
		const focusNode = selection.focusNode;
		if (!focusNode) return null;

		const range = document.createRange();

		try {
			const maxOffset = focusNode.nodeType === Node.TEXT_NODE
				? (focusNode as Text).length
				: (focusNode.childNodes?.length ?? 0);

			const offset = Math.min(selection.focusOffset, maxOffset);
			range.setStart(focusNode, offset);
			range.setEnd(focusNode, offset);
			const rect = range.getBoundingClientRect();
			return rect.width || rect.height ? rect : null;
		} catch (e) {
			return null;
		}
	}

	// 获取当前光标位置的函数
	getCursorPosition(i: number, isTitle?: boolean) {

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return { x: -1, y: -1, height: 0, width: 0 };
		}

		let editorDomRect = this.editorDom[i].getBoundingClientRect();

		if (isTitle) {
			//点击标题，cm 不更新，单独处理
			let range = selection.getRangeAt(0);
			let rect = this.getCollapsedSelectionRect(selection) || range.getBoundingClientRect();

			if (rect) {
				return {
					x: rect.x + window.scrollX - editorDomRect.x,
					y: rect.y + window.scrollY - editorDomRect.y,
					height: rect.height,
					width: this.resolveCursorWidth(rect.width, selection, i),
				}
			}
		} else {
			//通过 cm 接口获取光标坐标
			const editor = this.app.workspace.activeEditor?.editor;
			const cmView = (editor as Editor & { cm: cmEditor })?.cm as cmEditorExtention; // CM6 的 EditorView 实例
			// console.log(cmView);
			if (cmView && editor) {
				const cursor = editor.getCursor();
				const offset = cmView.state.doc.line(cursor.line + 1).from + cursor.ch;
					let rect = cmView.coordsForChar(offset); // 获取 DOMRect
					if (!rect) {
						//判断是否表格
						let range = selection.getRangeAt(0);
						let node = range.commonAncestorContainer;
						let isTable = false;

					let tempNode: Node | null = node;

					while (tempNode) {
						if (tempNode.nodeType === Node.ELEMENT_NODE) {
							// 尝试获取元素节点的右下角
							isTable = Array.from((tempNode as HTMLElement).classList).some(cls => cls.includes("table"));
						} else if (tempNode.nodeType === Node.TEXT_NODE) {
							isTable = Array.from((tempNode.parentElement as HTMLElement).classList).some(cls => cls.includes("table"));
						}

						if (isTable) {
							break;
						} else {
							tempNode = tempNode.parentNode;
						}
						}

						if (isTable) {

							if ((!this.mouseMoveTaget || this.mouseMoveTaget.down.textContent === this.mouseMoveTaget.move.textContent)
								&& node.nodeType === Node.TEXT_NODE) {
								let dir = this.mouseForX.move <= this.mouseForX.down;
								const tempRange = document.createRange();
								tempRange.setStart(node, dir ? range.startOffset : range.endOffset);
								tempRange.setEnd(node, dir ? range.startOffset : range.endOffset);
								const rect = tempRange.getBoundingClientRect();
								return {
									x: rect.x + (dir ? 0 : rect.width) + window.scrollX - editorDomRect.x,
									y: rect.y + window.scrollY - editorDomRect.y,
									height: rect.height,
									width: this.resolveCursorWidth(rect.width, selection, i),
								}
							}

							const focusRect = this.getCollapsedSelectionRect(selection);
							if (focusRect) {
								return {
									x: focusRect.x + window.scrollX - editorDomRect.x,
									y: focusRect.y + window.scrollY - editorDomRect.y,
									height: focusRect.height,
									width: this.resolveCursorWidth(focusRect.width, selection, i),
								}
							}

							if (this.lastPos[i]) return this.lastPos[i];

						} else {
							//行尾或者空行需要单独处理
							const domInfo = cmView.domAtPos(offset);
							node = domInfo.node;

						if (!node.parentElement?.classList.contains("cm-contentContainer")) {
							if (node.nodeType === Node.ELEMENT_NODE) {
								// 尝试获取元素节点的右下角
								const rects = (node as Element).getClientRects();
								if (rects.length > 0) {
									rect = rects[rects.length - 1]; // 返回最后一个可视矩形
								}
							} else if (node.nodeType === Node.TEXT_NODE) {
								const range = document.createRange();
								range.setStart(node, domInfo.offset);
								range.setEnd(node, domInfo.offset);
								const rt = range.getBoundingClientRect();
								if (rt.width || rt.height) rect = rt;
							}
						}
					}
				}

				if (rect) {
					return {
						x: rect.left + window.scrollX - editorDomRect.x,
						y: rect.top + window.scrollY - editorDomRect.y,
						height: rect.bottom - rect.top,
						width: this.resolveCursorWidth(rect.right - rect.left, selection, i),
					};
				}
			}
		}

		return { x: -1, y: -1, height: 0, width: 0 };  // 如果没有有效的选择，返回无效位置
	}

		startObserving(index: number, retry: number = 0) {
			// 获取 Obsidian 的 workspace 主体
			let root = this.editorDom[index]?.querySelector('.cm-contentContainer');

			if (!root) {
				if (retry > 30) return; // 避免无限重试
				this.delayedFrames(() => this.startObserving(index, retry + 1), 2);
				return;
			}

			const hasContentChange = (mutation: MutationRecord) => {
				if (mutation.type !== 'childList') return false;

				const isMeaningful = (node: Node) => node.nodeName != "BR" && !(node as HTMLDivElement).classList?.contains("table-cell-wrapper");

				for (let i = 0; i < mutation.addedNodes.length; i++) {
					if (isMeaningful(mutation.addedNodes[i])) return true;
				}

				for (let i = 0; i < mutation.removedNodes.length; i++) {
					if (isMeaningful(mutation.removedNodes[i])) return true;
				}

				return false;
			};

			this.observer = new MutationObserver((mutations) => {
				let changed = false;

				for (const mutation of mutations) {
					if (hasContentChange(mutation)) {
						changed = true;
						break;
					}
				}

				if (changed) {
					this.delayedFrames(() => {
						this.updateCursor(index);
				});
			}
		});

		this.settingObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {

					for (let i = 0; i < mutation.addedNodes.length; i++) {
						if (mutation.addedNodes[i].nodeName == "DIV" && (mutation.addedNodes[i] as HTMLDivElement).classList?.contains("modal-container")) {
							// console.log("Obsidian 设置面板（模态框）已打开");
							this.focus = false;
							document.body.removeClass("caret-hide");
							this.cursor[index]?.removeClass("show");
							break;
						}
					}

					for (let i = 0; i < mutation.removedNodes.length; i++) {
						if (mutation.removedNodes[i].nodeName == "DIV" && (mutation.removedNodes[i] as HTMLDivElement).classList?.contains("modal-container")) {
							// console.log("Obsidian 设置面板（模态框）已关闭");
							this.focus = true;
							document.body.addClass("caret-hide");
							// this.cursor?.addClass("show");
							this.closeSettings = true;
							break;
						}
					}
				}
			}
		});

		// 监听子元素变化（比如标题的修改）
		this.observer.observe(root, {
			childList: true,      // 监听子节点添加/删除
			subtree: true,        // 监听整个子树
			// characterData: true,  // 监听文本变化
		});

		this.settingObserver.observe(document.body, {
			childList: true,      // 监听子节点添加/删除
			subtree: true,        // 监听整个子树
		});
	}

	stopObserving() {
		this.observer?.disconnect();
		this.observer = null;

		this.settingObserver?.disconnect();
		this.settingObserver = null;
	}

	delayedFrames(callback: Function, delay: number = 2) {
		let frameCount = 0;
		let self = this;

		const run = () => {
			frameCount++;

			if (frameCount === delay) {
				callback.call(self);
			} else {
				requestAnimationFrame(run);
			}
		};

		requestAnimationFrame(run);
	}

	/** 创建canvas */
	createTrail(i: number) {
		// 创建拖尾画布
		this.canvas[i] = this.editorDom[i].createEl("canvas", { cls: "smooth-cursor-busyo-canvas" });
		this.canvas[i].id = "trail-canvas-" + i;

		this.ctx[i] = this.canvas[i].getContext("2d");

		const rect = this.editorDom[i].getBoundingClientRect();
		this.canvas[i].width = rect.width;
		this.canvas[i].height = rect.height;
		this.lastRect[i] = { x: 0, y: 0, width: 0, height: 0 };
	}

	// 绘制拖尾
	drawTrail(i: number) {
		const ctx = this.ctx[i];
		if (!ctx) return;

		// console.log("绘制拖尾", this.trailCount[i])

		this.trailCount[i]--;

		let ratio = this.trailCount[i] / this.setting.trailStep;

		let targetX1 = this.rectangle[i].x - this.rectangle[i].dirX * 0.15 * Math.max(0, (-0.3 + ratio));
		let targetX2 = targetX1;

		let originX1 = this.rectangle[i].x - this.rectangle[i].dirX * ratio;
		let originX2 = originX1;

		if (this.rectangle[i].dirX === 3) {
			targetX1 = this.rectangle[i].x;
			targetX2 = targetX1;

			originX1 = this.rectangle[i].x - this.rectangle[i].dirX;
			originX2 = originX1;

		} else if (this.rectangle[i].dirY < 0) {
			targetX2 = this.rectangle[i].x - this.rectangle[i].dirX * 0.05 * Math.max(0, (-0.3 + ratio));
			originX1 = this.rectangle[i].x - this.rectangle[i].dirX * Math.max(0, (ratio - 0.02));
		} else if (this.rectangle[i].dirY > 0) {
			targetX1 = this.rectangle[i].x - this.rectangle[i].dirX * 0.05 * Math.max(0, (-0.3 + ratio));
			originX2 = this.rectangle[i].x - this.rectangle[i].dirX * Math.max(0, (ratio - 0.02));
		}

		let heightDiff = this.rectangle[i].extTarget - this.rectangle[i].extOrigin;

		const lastRect = this.lastRect[i];
		if (lastRect) {
			ctx.clearRect(lastRect.x, lastRect.y, lastRect.width, lastRect.height);
		}

		ctx.beginPath();

		ctx.moveTo(targetX1, this.rectangle[i].y + this.rectangle[i].extTarget);
		ctx.lineTo(targetX2, this.rectangle[i].y);
		ctx.lineTo(originX1, this.rectangle[i].y - this.rectangle[i].dirY * ratio);
		ctx.lineTo(originX2, this.rectangle[i].y - this.rectangle[i].dirY * ratio + this.rectangle[i].extTarget - heightDiff * ratio);

		ctx.closePath();

		ctx.fillStyle = this.setting.trailColor; // 设置填充颜色
		ctx.fill(); // 填充形状
		// ctx.strokeStyle = "black"; // 设置描边颜色
		// ctx.stroke(); // 描边

		// 计算边界框
		const minX = Math.min(targetX1, targetX2, originX1, originX2);
		const maxX = Math.max(targetX1, targetX2, originX1, originX2);
		const minY = Math.min(
			this.rectangle[i].y - this.rectangle[i].dirY * ratio,
			this.rectangle[i].y,
			this.rectangle[i].y + this.rectangle[i].extTarget,
			this.rectangle[i].y - this.rectangle[i].dirY * ratio + this.rectangle[i].extTarget - heightDiff * ratio
		);
		const maxY = Math.max(
			this.rectangle[i].y - this.rectangle[i].dirY * ratio,
			this.rectangle[i].y,
			this.rectangle[i].y + this.rectangle[i].extTarget,
			this.rectangle[i].y - this.rectangle[i].dirY * ratio + this.rectangle[i].extTarget - heightDiff * ratio
		);
		this.lastRect[i] = {
			x: minX - 50,
			y: minY - 50,
			width: (maxX - minX) + 100,
			height: (maxY - minY) + 100
		};
	}

	// 动画循环
	animate(i: number) {
		if (Object.keys(this.canvas).length === 0) {
			return;
		}

		const ctx = this.ctx[i];
		if (!this.canvas[i] || !this.rectangle[i] || ctx === null || ctx === undefined) {
			return;
		}

		if (this.cursor[i] && this.trailCount[i] != undefined && this.trailCount[i] <= 0) {
			ctx.clearRect(0, 0, this.canvas[i].width, this.canvas[i].height);
			this.focus && !this.closeSettings && this.cursor[i].addClass("show");
			return;
		}

		this.drawTrail(i);
		requestAnimationFrame(() => this.animate(i));
	}

	/**
	 * 更新拖尾坐标
	 */
	updateTrail(i: number, lastX: number, lastY: number, x: number, y: number, widthTarget: number, widthOrigin: number) {
		if (!this.cursor[i]) return;

		if (this.isFirstTrail[i]) {
			this.isFirstTrail[i] = false;
			this.cursor[i].addClass("show");
			return;
		}

		let dx = x - lastX;
		let dy = y - lastY;
		if (!this.rectangle[i]) {
			this.rectangle[i] = { x: 0, y: 0, dirX: 0, dirY: 0, extTarget: 0, extOrigin: 0 };
		}
		this.rectangle[i].x = x;
		this.rectangle[i].y = y;
		this.rectangle[i].dirX = dx == 0 ? 3 : dx;
		this.rectangle[i].dirY = dy;

		this.rectangle[i].extTarget = widthTarget;
		this.rectangle[i].extOrigin = widthOrigin;

		this.trailCount[i] = this.setting.trailStep;

		this.cursor[i].removeClass("show");

		this.animate(i);
	}

	async loadSettings() {
		this.setting = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.setting);
	}

	updateSetting() {
		if (!this.cursor) return;
	}
}
