import { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import type SmoothCursorPlugin from '../main';

/**
 * Diagnostic service for cursor state debugging
 */
export class DiagnosticService {
  private plugin: SmoothCursorPlugin;

  constructor(plugin: SmoothCursorPlugin) {
    this.plugin = plugin;
  }

  /**
   * Show diagnostic information about the cursor state
   */
  showCursorDiagnostic(activeEditorView: EditorView | null) {
    const info: Record<string, unknown> = {
      pluginLoaded: true,
      debugMode: this.plugin.settings.debug,
      vimMode: this.plugin.getVimMode(),
      hasActiveEditor: !!activeEditorView,
      hasCursorRenderer: !!this.plugin.cursorRenderer,
      hasAnimationEngine: !!this.plugin.animationEngine,
    };

    if (activeEditorView) {
      const sel = activeEditorView.state.selection.main;
      const pos = sel.head;
      const doc = activeEditorView.state.doc;
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
      const contentRect = activeEditorView.contentDOM.getBoundingClientRect();
      info.contentDOMRect = {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
      };
      
      // Check if smooth-cursor-active class is set
      info.editorHasActiveClass = activeEditorView.dom.classList.contains('smooth-cursor-active');

      // Check native cursor
      const nativeCursor = activeEditorView.dom.querySelector('.cm-cursor, .cm-cursor-primary');
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
        const coords = activeEditorView.coordsAtPos(pos, 1);
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
}

