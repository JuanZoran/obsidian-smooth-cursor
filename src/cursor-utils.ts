import type { CursorPosition, CursorShape } from './types';

/**
 * Calculate cursor dimensions based on shape
 * @param pos - Cursor position with base width/height
 * @param shape - Cursor shape (block, line, underline)
 * @returns Adjusted width, height, and y offset
 */
export function calculateCursorDimensions(
  pos: CursorPosition,
  shape: CursorShape
): { width: number; height: number; yOffset: number } {
  let width = pos.width;
  let height = pos.height;
  let yOffset = 0;

  switch (shape) {
    case 'line':
      // Line cursor: thin vertical bar
      width = 2;
      break;
    case 'underline':
      // Underline cursor: thin horizontal bar at bottom
      height = 2;
      yOffset = pos.height - 2;
      break;
    case 'block':
    default:
      // Block cursor: full character width
      break;
  }

  return { width, height, yOffset };
}

/**
 * Check if cursor position is within the visible viewport
 * @param pos - Cursor position
 * @returns Whether the cursor is visible in the viewport
 */
export function isCursorInView(pos: CursorPosition): boolean {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return (
    pos.x >= 0 &&
    pos.x <= viewportWidth &&
    pos.y >= 0 &&
    pos.y <= viewportHeight
  );
}
