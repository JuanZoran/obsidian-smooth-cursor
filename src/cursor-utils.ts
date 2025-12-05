import type { CursorPosition, CursorShape } from './types';

/**
 * Calculate cursor dimensions based on shape
 * Extracted to avoid duplication between CursorRenderer and NonEditorCursor
 */
export function calculateCursorDimensions(
  position: CursorPosition,
  shape: CursorShape
): { width: number; height: number; yOffset: number } {
  let width = position.width;
  let height = position.height;
  let yOffset = 0;
  
  switch (shape) {
    case 'line':
      width = 2;
      break;
    case 'underline':
      height = 2;
      yOffset = position.height - 2;
      break;
    case 'block':
    default:
      // Use full character width and height
      break;
  }
  
  return { width, height, yOffset };
}

/**
 * Check if cursor position is within visible scroll area
 */
export function isCursorInView(
  coords: { left: number; top: number },
  charWidth: number,
  lineHeight: number,
  scrollRect: DOMRect
): boolean {
  return !(
    coords.top < scrollRect.top ||
    coords.top > scrollRect.bottom - lineHeight ||
    coords.left < scrollRect.left ||
    coords.left > scrollRect.right - charWidth
  );
}

