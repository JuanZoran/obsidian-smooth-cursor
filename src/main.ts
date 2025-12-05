import { Plugin, MarkdownView, WorkspaceLeaf, Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { SmoothCursorSettingTab } from './settings';
import { VimStateProvider } from './vim-state';
import { CursorRenderer } from './cursor-renderer';
import { AnimationEngine } from './animation';
import { NonEditorCursor } from './non-editor-cursor';
import { DEFAULT_SETTINGS, type SmoothCursorSettings, type VimMode } from './types';

export default class SmoothCursorPlugin extends Plugin {
  settings: SmoothCursorSettings = DEFAULT_SETTINGS;
  vimState: VimStateProvider | null = null;
  private cursorRenderer: CursorRenderer | null = null;
  private animationEngine: AnimationEngine | null = null;
  private nonEditorCursor: NonEditorCursor | null = null;
  private activeEditorView: EditorView | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    
    // Add settings tab
    this.addSettingTab(new SmoothCursorSettingTab(this.app, this));
    
    // Initialize components
    this.vimState = new VimStateProvider(this);
    this.animationEngine = new AnimationEngine(this);
    this.cursorRenderer = new CursorRenderer(this, this.animationEngine);
    this.nonEditorCursor = new NonEditorCursor(this);
    
    // Inject global styles
    this.injectStyles();
    
    // Add status bar item (for debug mode)
    this.setupStatusBar();
    
    // Register workspace events
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.onActiveLeafChange(leaf);
      })
    );

    // Initial setup when layout is ready
    this.app.workspace.onLayoutReady(() => {
      this.onActiveLeafChange(this.app.workspace.activeLeaf);
      this.debug('Smooth Cursor plugin loaded');
    });

    // Add commands for debugging
    this.addCommand({
      id: 'force-refresh-cursor',
      name: '强制刷新光标',
      callback: () => {
        this.cursorRenderer?.forceUpdate();
        console.log('[SmoothCursor] Cursor force refreshed');
      },
    });

    this.addCommand({
      id: 'show-cursor-diagnostic',
      name: '显示光标诊断信息',
      callback: () => {
        this.showCursorDiagnostic();
      },
    });
  }

  /**
   * Show diagnostic information about the cursor state
   */
  private showCursorDiagnostic() {
    const info: Record<string, unknown> = {
      pluginLoaded: true,
      debugMode: this.settings.debug,
      vimMode: this.getVimMode(),
      hasActiveEditor: !!this.activeEditorView,
      hasCursorRenderer: !!this.cursorRenderer,
      hasAnimationEngine: !!this.animationEngine,
    };

    if (this.activeEditorView) {
      const sel = this.activeEditorView.state.selection.main;
      const pos = sel.head;
      const doc = this.activeEditorView.state.doc;
      const line = doc.lineAt(pos);
      
      info.cursorPosition = pos;
      info.lineNumber = line.number;
      info.lineLength = line.length;
      info.documentLength = doc.length;
      
      // Check if cursor element exists (now in document.body)
      const cursorEl = document.body.querySelector('.smooth-cursor');
      info.cursorElementExists = !!cursorEl;
      info.cursorElementInBody = !!document.body.querySelector('.smooth-cursor');
      
      if (cursorEl) {
        const rect = cursorEl.getBoundingClientRect();
        info.cursorElementRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
        const style = window.getComputedStyle(cursorEl);
        info.cursorElementStyle = {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          left: style.left,
          top: style.top,
          zIndex: style.zIndex,
        };
        info.cursorElementConnected = cursorEl.isConnected;
      }
      
      // Content DOM info
      const contentRect = this.activeEditorView.contentDOM.getBoundingClientRect();
      info.contentDOMRect = {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      };
      
      // Check if smooth-cursor-active class is set
      info.editorHasActiveClass = this.activeEditorView.dom.classList.contains('smooth-cursor-active');

      // Check native cursor
      const nativeCursor = this.activeEditorView.dom.querySelector('.cm-cursor, .cm-cursor-primary');
      info.nativeCursorExists = !!nativeCursor;
      if (nativeCursor) {
        const rect = nativeCursor.getBoundingClientRect();
        info.nativeCursorRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }

      // Try to get coords
      try {
        const coords = this.activeEditorView.coordsAtPos(pos, 1);
        info.coordsAtPos = coords ? { left: coords.left, top: coords.top } : null;
      } catch (e) {
        info.coordsAtPosError = String(e);
      }
    }

    console.log('[SmoothCursor] Cursor Diagnostic:', info);
    console.table(info);
    
    // Also show a notice
    const noticeText = `Smooth Cursor 诊断信息已输出到控制台\n行: ${info.lineNumber || '?'}, 位置: ${info.cursorPosition || '?'}`;
    new Notice(noticeText, 5000);
  }

  onunload() {
    this.cursorRenderer?.destroy();
    this.animationEngine?.stop();
    this.vimState?.destroy();
    this.nonEditorCursor?.destroy();
    this.styleEl?.remove();
    this.statusBarEl?.remove();
    this.debug('Smooth Cursor plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Update cursor CSS variables
   */
  updateCursorStyle() {
    if (this.styleEl) {
      this.styleEl.textContent = this.generateStyles();
    }
  }

  /**
   * Get current vim mode
   */
  getVimMode(): VimMode {
    return this.vimState?.getCurrentMode() ?? 'normal';
  }

  /**
   * Get the active CodeMirror EditorView
   */
  getActiveEditorView(): EditorView | null {
    return this.activeEditorView;
  }

  /**
   * Debug logging helper
   */
  debug(...args: unknown[]) {
    if (this.settings.debug) {
      console.log('[SmoothCursor]', ...args);
    }
  }

  private onActiveLeafChange(leaf: WorkspaceLeaf | null) {
    if (!leaf) {
      this.activeEditorView = null;
      this.cursorRenderer?.detach();
      return;
    }

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      // Get CodeMirror 6 EditorView from MarkdownView
      // @ts-expect-error - accessing internal API
      const editorView = view.editor?.cm as EditorView | undefined;
      
      if (editorView) {
        this.activeEditorView = editorView;
        this.cursorRenderer?.attach(editorView);
        this.vimState?.attach(editorView);
        this.debug('Attached to editor view');
      }
    } else {
      this.activeEditorView = null;
      this.cursorRenderer?.detach();
    }
  }

  private injectStyles() {
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'smooth-cursor-styles';
    this.styleEl.textContent = this.generateStyles();
    document.head.appendChild(this.styleEl);
  }

  private setupStatusBar() {
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('smooth-cursor-status');
    this.updateStatusBar();
    
    // Listen for mode changes to update status bar
    this.vimState?.onModeChange(() => {
      this.updateStatusBar();
    });
  }

  private updateStatusBar() {
    if (!this.statusBarEl || !this.settings.debug) {
      if (this.statusBarEl) {
        this.statusBarEl.empty();
      }
      return;
    }

    const mode = this.getVimMode();
    this.statusBarEl.empty();
    
    const indicator = this.statusBarEl.createEl('span', {
      cls: `smooth-cursor-mode-indicator ${mode}`,
      text: mode.toUpperCase(),
    });
    indicator.setAttribute('aria-label', `Smooth Cursor: ${mode} mode`);
  }

  private generateStyles(): string {
    const { cursorColor, cursorOpacity, animationDuration } = this.settings;
    // Convert animation duration from ms to seconds for CSS
    const transitionDuration = animationDuration / 1000;
    
    return `
      /* Hide native cursor when Smooth Cursor is active - CodeMirror 6 */
      /* Use visibility:hidden instead of display:none so we can still read position from DOM */
      .smooth-cursor-active .cm-cursor,
      .smooth-cursor-active .cm-cursor-primary,
      .smooth-cursor-active .cm-cursor-secondary {
        visibility: hidden !important;
        opacity: 0 !important;
        border-left-color: transparent !important;
        border-color: transparent !important;
        background: transparent !important;
      }
      
      /* Keep cursor layer in DOM but make cursors invisible */
      .smooth-cursor-active .cm-cursorLayer {
        /* Don't use display:none - keep in DOM for position reference */
        pointer-events: none;
      }
      
      .smooth-cursor-active .cm-content {
        caret-color: transparent !important;
      }
      
      /* Ensure text selection is still visible but cursor is hidden */
      .smooth-cursor-active .cm-selectionBackground {
        /* Keep selection visible */
      }

      /* Smooth Cursor cursor container */
      .smooth-cursor {
        position: absolute;
        pointer-events: none;
        z-index: 100;
        background-color: ${cursorColor};
        opacity: ${cursorOpacity};
        border-radius: 1px;
        will-change: transform, width, height;
        transition: background-color 0.15s ease;
        /* Note: width/height transitions removed - handled by JavaScript animation engine */
      }

      .smooth-cursor.block {
        /* Block cursor - full character width */
      }

      .smooth-cursor.line {
        width: 2px !important;
      }

      .smooth-cursor.underline {
        height: 2px !important;
        bottom: 0;
      }

      /* Cursor blink animation */
      @keyframes smooth-cursor-blink {
        0%, 100% { opacity: ${cursorOpacity}; }
        50% { opacity: ${cursorOpacity * 0.3}; }
      }

      .smooth-cursor.blink {
        animation: smooth-cursor-blink 1s ease-in-out infinite;
      }

      /* Non-editor cursor styles */
      .smooth-cursor-non-editor {
        position: absolute;
        pointer-events: none;
        z-index: 1000;
        background-color: ${cursorColor};
        opacity: ${cursorOpacity};
      }
    `;
  }
}

