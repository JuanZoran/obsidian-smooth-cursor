import { EditorView } from '@codemirror/view';
import { getNativeCursorPosition } from './dom-utils';

/**
 * Editor utility functions
 */

/**
 * Check if editor has focus
 */
export function isEditorFocused(editorView: EditorView | null): boolean {
  if (!editorView) return false;
  
  const editorDom = editorView.dom;
  const activeElement = document.activeElement;
  
  if (!activeElement) return false;
  
  return editorDom.contains(activeElement) || editorDom === activeElement;
}

/**
 * Get default character width from editor
 */
export function getDefaultCharWidth(editorView: EditorView | null): number {
  if (!editorView) return 8;
  return editorView.defaultCharacterWidth || 8;
}

/**
 * Get default line height from editor
 */
export function getDefaultLineHeight(editorView: EditorView | null): number {
  if (!editorView) return 20;
  return editorView.defaultLineHeight || 20;
}

/**
 * Get cursor coordinates with fallback strategies
 */
export function getCursorCoords(
  editorView: EditorView,
  pos: number,
  lastSuccessfulCoords: { left: number; top: number } | null
): { left: number; top: number } | null {
  const saveAndReturn = (coords: { left: number; top: number }) => coords;

  // Strategy 1: Try with side: 1 (most common case)
  let coords = editorView.coordsAtPos(pos, 1);
  if (coords) {
    return saveAndReturn(coords);
  }

  // Strategy 2: Try with side: -1
  coords = editorView.coordsAtPos(pos, -1);
  if (coords) {
    return saveAndReturn(coords);
  }

  // Strategy 3: Use native CM cursor position
  const nativeCursorCoords = getNativeCursorPosition(editorView.dom);
  if (nativeCursorCoords) {
    return saveAndReturn(nativeCursorCoords);
  }

  // Strategy 4: Use last successful coordinates
  if (lastSuccessfulCoords) {
    return lastSuccessfulCoords;
  }

  return null;
}

