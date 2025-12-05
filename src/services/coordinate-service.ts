import { EditorView } from '@codemirror/view';
import { getCursorCoords } from '../utils/editor-utils';

/**
 * Coordinate service for cursor position calculation with caching
 */
export class CoordinateService {
  private editorView: EditorView | null = null;
  private lastSuccessfulCoords: { left: number; top: number } | null = null;
  
  // Coordinate caching
  private coordsCache: Map<number, { coords: { left: number; top: number }; timestamp: number }> = new Map();
  private coordsCacheMaxAge = 50; // Cache valid for 50ms
  private coordsCacheMaxSize = 10;

  /**
   * Attach to an EditorView
   */
  attach(editorView: EditorView) {
    this.editorView = editorView;
  }

  /**
   * Detach from current editor
   */
  detach() {
    this.editorView = null;
    this.lastSuccessfulCoords = null;
    this.coordsCache.clear();
  }

  /**
   * Get cursor coordinates with caching
   */
  getCursorCoordsCached(pos: number): { left: number; top: number } | null {
    if (!this.editorView) return null;

    const now = performance.now();
    
    // Check cache
    const cached = this.coordsCache.get(pos);
    if (cached && (now - cached.timestamp) < this.coordsCacheMaxAge) {
      return cached.coords;
    }
    
    // Get fresh coords
    const coords = getCursorCoords(this.editorView, pos, this.lastSuccessfulCoords);
    
    if (coords) {
      // Update last successful coords
      this.lastSuccessfulCoords = coords;
      
      // Update cache
      this.coordsCache.set(pos, { coords, timestamp: now });
      
      // Limit cache size
      if (this.coordsCache.size > this.coordsCacheMaxSize) {
        const firstKey = this.coordsCache.keys().next().value;
        if (firstKey !== undefined) {
          this.coordsCache.delete(firstKey);
        }
      }
    }
    
    return coords;
  }

  /**
   * Clear coordinate cache
   */
  clearCache() {
    this.coordsCache.clear();
  }

  /**
   * Get last successful coordinates
   */
  getLastSuccessfulCoords(): { left: number; top: number } | null {
    return this.lastSuccessfulCoords;
  }
}

