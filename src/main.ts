import { Plugin, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { SmoothCursorSettingTab } from './settings';
import { VimStateProvider } from './vim-state';
import { CursorRenderer } from './cursor-renderer';
import { AnimationEngine } from './animation';
import { NonEditorCursor } from './non-editor-cursor';
import { DEFAULT_SETTINGS, type SmoothCursorSettings, type VimMode } from './types';
import { StyleManager } from './core/style-manager';
import { StatusBarManager } from './core/status-bar-manager';
import { DiagnosticService } from './services/diagnostic-service';

export default class SmoothCursorPlugin extends Plugin {
  settings: SmoothCursorSettings = DEFAULT_SETTINGS;
  vimState: VimStateProvider | null = null;
  cursorRenderer: CursorRenderer | null = null;
  animationEngine: AnimationEngine | null = null;
  private nonEditorCursor: NonEditorCursor | null = null;
  private activeEditorView: EditorView | null = null;
  
  // Managers
  private styleManager: StyleManager;
  private statusBarManager: StatusBarManager;
  private diagnosticService: DiagnosticService;

  async onload() {
    await this.loadSettings();
    
    // Initialize managers
    this.styleManager = new StyleManager();
    this.statusBarManager = new StatusBarManager(this);
    this.diagnosticService = new DiagnosticService(this);
    
    // Add settings tab
    this.addSettingTab(new SmoothCursorSettingTab(this.app, this));
    
    // Initialize components
    this.vimState = new VimStateProvider(this);
    this.animationEngine = new AnimationEngine(this);
    this.cursorRenderer = new CursorRenderer(this, this.animationEngine);
    this.nonEditorCursor = new NonEditorCursor(this);
    
    // Inject global styles
    this.styleManager.injectStyles(this.settings);
    
    // Add status bar item (for debug mode)
    this.statusBarManager.setup();
    
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
        this.diagnosticService.showCursorDiagnostic(this.activeEditorView);
      },
    });
  }

  onunload() {
    this.cursorRenderer?.destroy();
    this.animationEngine?.stop();
    this.vimState?.destroy();
    this.nonEditorCursor?.destroy();
    this.styleManager.removeStyles();
    this.statusBarManager.remove();
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
    this.styleManager.updateStyles(this.settings);
    // Force cursor to update shape/animation when styles change
    if (this.cursorRenderer) {
      // Trigger update to apply new animation settings
      requestAnimationFrame(() => {
        this.cursorRenderer?.forceUpdate();
      });
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
}
