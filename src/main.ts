import { Plugin, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { SmoothCursorSettingTab } from './settings';
import { VimStateProvider } from './vim-state';
import { CursorRenderer } from './cursor-renderer';
import { AnimationEngine } from './animation';
import { DEFAULT_SETTINGS, type SmoothCursorSettings, type VimMode } from './types';
import { StyleManager } from './core/style-manager';
import { DiagnosticService } from './services/diagnostic-service';

export default class SmoothCursorPlugin extends Plugin {
  settings: SmoothCursorSettings = DEFAULT_SETTINGS;
  vimState: VimStateProvider | null = null;
  cursorRenderer: CursorRenderer | null = null;
  animationEngine: AnimationEngine | null = null;
  private activeEditorView: EditorView | null = null;
  private currentCodeMirrorEditor: any = null; // CodeMirror 5 editor instance for vim-mode-change event
  
  // Managers
  private styleManager: StyleManager;
  private diagnosticService: DiagnosticService;

  async onload() {
    await this.loadSettings();
    
    // Initialize managers
    this.styleManager = new StyleManager();
    this.diagnosticService = new DiagnosticService(this);
    
    // Add settings tab
    this.addSettingTab(new SmoothCursorSettingTab(this.app, this));
    
    // Initialize components
    this.vimState = new VimStateProvider(this);
    this.animationEngine = new AnimationEngine(this);
    this.cursorRenderer = new CursorRenderer(this, this.animationEngine);
    
    // Inject global styles
    this.styleManager.injectStyles(this.settings);
    
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
    // Clean up vim-mode-change event listener
    if (this.currentCodeMirrorEditor && this.vimState) {
      try {
        this.currentCodeMirrorEditor.off('vim-mode-change', this.vimState.onVimModeChanged);
      } catch (e) {
        this.debug('Error removing vim-mode-change listener on unload:', e);
      }
      this.currentCodeMirrorEditor = null;
    }
    
    this.cursorRenderer?.destroy();
    this.animationEngine?.stop();
    this.vimState?.destroy();
    this.styleManager.removeStyles();
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
    // Clean up previous vim-mode-change event listener
    if (this.currentCodeMirrorEditor && this.vimState) {
      try {
        this.currentCodeMirrorEditor.off('vim-mode-change', this.vimState.onVimModeChanged);
      } catch (e) {
        this.debug('Error removing vim-mode-change listener:', e);
      }
      this.currentCodeMirrorEditor = null;
    }

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
      
      // Get CodeMirror 5 editor instance for vim-mode-change event
      // For CM6 this actually returns an instance of the object named CodeMirror from cm_adapter of codemirror_vim
      // accessing internal API
      const codeMirrorEditor = (view as any).sourceMode?.cmEditor?.cm?.cm;
      
      if (editorView) {
        this.activeEditorView = editorView;
        this.cursorRenderer?.attach(editorView);
        this.vimState?.attach(editorView);
        
        // Set up vim-mode-change event listener on CodeMirror 5 editor
        if (codeMirrorEditor && this.vimState) {
          try {
            // Remove any existing listener first (in case it wasn't cleaned up)
            codeMirrorEditor.off('vim-mode-change', this.vimState.onVimModeChanged);
            // Add new listener
            codeMirrorEditor.on('vim-mode-change', this.vimState.onVimModeChanged);
            this.currentCodeMirrorEditor = codeMirrorEditor;
            this.debug('Attached vim-mode-change event listener to editor');
          } catch (e) {
            this.debug('Error setting up vim-mode-change listener:', e);
            // Fallback to existing detection methods if event listener fails
          }
        } else {
          this.debug('CodeMirror editor not found, using DOM detection only');
        }
        
        this.debug('Attached to editor view');
      }
    } else {
      this.activeEditorView = null;
      this.cursorRenderer?.detach();
    }
  }
}
