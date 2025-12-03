/**
 * Type guard functions for safely accessing Obsidian internal APIs
 */

import { EditorView } from '@codemirror/view';
import { MarkdownView } from 'obsidian';
import type { CodeMirror5Editor } from '../types/obsidian-extensions';

/**
 * Type guard to check if MarkdownView has EditorView accessible
 * @param view - The MarkdownView instance
 * @returns true if EditorView is accessible via internal API
 */
export function hasEditorView(view: MarkdownView): view is MarkdownView & {
  editor: { cm: EditorView };
} {
  // Use type assertion to access internal API
  const editor = (view as any).editor;
  return !!(editor?.cm);
}

/**
 * Safely get EditorView from MarkdownView
 * @param view - The MarkdownView instance
 * @returns EditorView if available, undefined otherwise
 */
export function getEditorViewFromMarkdownView(view: MarkdownView): EditorView | undefined {
  // Use type assertion to access internal API
  const editor = (view as any).editor;
  return editor?.cm;
}

/**
 * Type guard to check if MarkdownView has CodeMirror 5 editor accessible
 * @param view - The MarkdownView instance
 * @returns true if CodeMirror 5 editor is accessible via internal API
 */
export function hasCodeMirror5Editor(view: MarkdownView): view is MarkdownView & {
  sourceMode: {
    cmEditor: {
      cm: {
        cm: CodeMirror5Editor;
      };
    };
  };
} {
  return !!(view.sourceMode?.cmEditor?.cm?.cm);
}

/**
 * Safely get CodeMirror 5 editor from MarkdownView
 * @param view - The MarkdownView instance
 * @returns CodeMirror 5 editor if available, undefined otherwise
 */
export function getCodeMirror5EditorFromMarkdownView(view: MarkdownView): CodeMirror5Editor | undefined {
  return view.sourceMode?.cmEditor?.cm?.cm;
}

/**
 * Type guard to check if EditorView has original dispatch stored
 * @param editorView - The EditorView instance
 * @returns true if __originalDispatch is available
 */
export function hasOriginalDispatch(editorView: EditorView): editorView is EditorView & {
  __originalDispatch: (tr: any) => void;
} {
  return typeof (editorView as any).__originalDispatch === 'function';
}

