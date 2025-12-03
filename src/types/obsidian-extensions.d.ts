/**
 * Type extensions for Obsidian internal APIs
 * These types extend the official Obsidian types to include internal APIs
 * that are commonly used by plugins but not officially documented.
 */

import { EditorView } from '@codemirror/view';
import { MarkdownView } from 'obsidian';

/**
 * CodeMirror 5 editor instance interface
 * Used for accessing vim-mode-change events
 */
export interface CodeMirror5Editor {
  on(event: 'vim-mode-change', handler: (mode: any) => void): void;
  off(event: 'vim-mode-change', handler: (mode: any) => void): void;
}

/**
 * Extended MarkdownView with internal API access
 * Extends the official MarkdownView type to include internal properties
 */
declare module 'obsidian' {
  interface MarkdownView {
    /**
     * Internal API: Access to CodeMirror 6 EditorView
     * This is accessed via view.editor.cm
     * WARNING: This is an internal API and may break in future Obsidian updates
     */
    editor?: {
      cm?: EditorView;
    };
    
    /**
     * Internal API: Access to CodeMirror 5 editor instance for vim-mode-change events
     * This is accessed via view.sourceMode.cmEditor.cm.cm
     * WARNING: This is an internal API and may break in future Obsidian updates
     */
    sourceMode?: {
      cmEditor?: {
        cm?: {
          cm?: CodeMirror5Editor;
        };
      };
    };
  }
}

/**
 * Extended EditorView with internal dispatch interception support
 * Used for transaction listening when ViewPlugin cannot be registered
 */
declare module '@codemirror/view' {
  interface EditorView {
    /**
     * Internal property used to store original dispatch method
     * when intercepting dispatch for transaction listening
     * WARNING: This is a workaround and may conflict with other plugins
     * Note: Made optional to allow delete operator
     */
    __originalDispatch?: (tr: any) => void;
  }
}

