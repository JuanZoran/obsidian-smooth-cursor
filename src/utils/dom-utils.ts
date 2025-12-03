/**
 * DOM utility functions for cursor operations
 */

/**
 * Get native cursor element from editor DOM
 */
export function getNativeCursorElement(editorDom: HTMLElement): HTMLElement | null {
  return editorDom.querySelector('.cm-cursor, .cm-cursor-primary');
}

/**
 * Get native cursor position from editor DOM
 * Returns null if cursor is not visible
 */
export function getNativeCursorPosition(editorDom: HTMLElement): { left: number; top: number } | null {
  try {
    const nativeCursor = getNativeCursorElement(editorDom);
    if (nativeCursor) {
      const rect = nativeCursor.getBoundingClientRect();
      // Check if visible (not hidden by visibility:hidden)
      if (rect.width > 0 || rect.height > 0) {
        return { left: rect.left, top: rect.top };
      }
    }
  } catch (e) {
    // Silently handle errors
  }

  return null;
}

/**
 * Check if an element is connected to the DOM
 */
export function isElementConnected(element: HTMLElement | null): boolean {
  return element?.isConnected ?? false;
}

/**
 * Check if an element has a specific class
 */
export function hasClass(element: HTMLElement | null, className: string): boolean {
  return element?.classList.contains(className) ?? false;
}

/**
 * Add class to element if not already present
 */
export function addClass(element: HTMLElement | null, className: string): void {
  if (element && !hasClass(element, className)) {
    element.classList.add(className);
  }
}

/**
 * Remove class from element if present
 */
export function removeClass(element: HTMLElement | null, className: string): void {
  if (element && hasClass(element, className)) {
    element.classList.remove(className);
  }
}

