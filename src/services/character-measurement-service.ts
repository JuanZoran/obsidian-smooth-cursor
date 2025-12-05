import { EditorView } from '@codemirror/view';
import { getDefaultCharWidth } from '../utils/editor-utils';

/**
 * Character measurement service with caching
 */
export class CharacterMeasurementService {
  private editorView: EditorView | null = null;
  
  // Character width caching  
  private charWidthCache: Map<string, number> = new Map();

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
    this.charWidthCache.clear();
  }

  /**
   * Measure character width with caching
   */
  measureCharacterWidthCached(pos: number): number {
    if (!this.editorView) return 8;

    const doc = this.editorView.state.doc;
    const docLength = doc.length;
    
    if (pos >= docLength) {
      return this.getDefaultCharWidth();
    }
    
    const line = doc.lineAt(pos);
    const offsetInLine = pos - line.from;
    const char = line.text[offsetInLine];
    
    if (!char || line.text.length === 0) {
      return this.getDefaultCharWidth();
    }

    // Check char width cache
    const cachedWidth = this.charWidthCache.get(char);
    if (cachedWidth !== undefined) {
      return cachedWidth;
    }

    // Measure width
    const width = this.measureCharacterWidth(pos);
    
    // Cache for common characters
    if (char.charCodeAt(0) < 256) {
      this.charWidthCache.set(char, width);
    }
    
    return width;
  }

  /**
   * Measure the width of the character at the given position
   */
  private measureCharacterWidth(pos: number): number {
    if (!this.editorView) return 8;

    const doc = this.editorView.state.doc;
    const docLength = doc.length;
    
    if (pos >= docLength) {
      return this.getDefaultCharWidth();
    }
    
    const line = doc.lineAt(pos);
    const offsetInLine = pos - line.from;
    const char = line.text[offsetInLine];
    
    if (!char || line.text.length === 0) {
      return this.getDefaultCharWidth();
    }

    try {
      const nextPos = Math.min(pos + 1, docLength);
      
      if (nextPos > pos) {
        const startCoords = this.editorView.coordsAtPos(pos, 1);
        const endCoords = this.editorView.coordsAtPos(nextPos, -1);
        
        if (startCoords && endCoords) {
          const width = endCoords.left - startCoords.left;
          if (width > 0) {
            return width;
          }
        }
      }
    } catch {
      // Fallback
    }

    return this.estimateCharWidth(char);
  }

  /**
   * Estimate character width based on character type
   */
  private estimateCharWidth(char: string): number {
    const defaultWidth = this.getDefaultCharWidth();
    
    const code = char.charCodeAt(0);
    
    // Quick check for CJK ranges
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code > 0x1F000)) {
      return defaultWidth * 2;
    }

    return defaultWidth;
  }

  /**
   * Get default character width from the editor
   */
  private getDefaultCharWidth(): number {
    return getDefaultCharWidth(this.editorView);
  }

  /**
   * Clear character width cache
   */
  clearCache(): void {
    this.charWidthCache.clear();
  }
}

