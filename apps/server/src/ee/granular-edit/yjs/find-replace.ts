import * as Y from 'yjs';

export interface FindReplaceResult {
  matchCount: number;
  replacedCount: number;
}

/**
 * Find and replace text within a Yjs XmlFragment.
 * Operates on XmlText nodes within the fragment tree.
 *
 * @param fragment - The Yjs XmlFragment to search within
 * @param findText - Text to search for
 * @param replaceText - Text to substitute in place of matches
 * @param matchCase - Whether to perform a case-sensitive search
 * @param occurrence - 1-based index of which match to replace, or -1 for all
 */
export function findAndReplaceInFragment(
  fragment: Y.XmlFragment,
  findText: string,
  replaceText: string,
  matchCase: boolean = false,
  occurrence: number = 1,
): FindReplaceResult {
  let matchCount = 0;
  let replacedCount = 0;
  const searchText = matchCase ? findText : findText.toLowerCase();

  function processNode(node: Y.XmlElement | Y.XmlText): void {
    if (node instanceof Y.XmlText) {
      let nodeText = node.toString();
      let compareText = matchCase ? nodeText : nodeText.toLowerCase();
      let offset = 0;

      while (true) {
        const idx = compareText.indexOf(searchText, offset);
        if (idx === -1) break;

        matchCount++;

        const shouldReplace = occurrence === -1 || matchCount === occurrence;
        if (shouldReplace) {
          node.delete(idx, findText.length);
          node.insert(idx, replaceText);
          replacedCount++;

          // Recalculate text after mutation since offsets have shifted
          nodeText = node.toString();
          compareText = matchCase ? nodeText : nodeText.toLowerCase();
          offset = idx + replaceText.length;
        } else {
          offset = idx + findText.length;
        }

        // If targeting a specific occurrence and we have replaced it, stop
        if (occurrence > 0 && replacedCount > 0) return;
      }
    } else if (node instanceof Y.XmlElement) {
      for (let i = 0; i < node.length; i++) {
        const child = node.get(i);
        if (child instanceof Y.XmlText || child instanceof Y.XmlElement) {
          processNode(child);
          if (occurrence > 0 && replacedCount > 0) return;
        }
      }
    }
  }

  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlText || child instanceof Y.XmlElement) {
      processNode(child);
      if (occurrence > 0 && replacedCount > 0) break;
    }
  }

  return { matchCount, replacedCount };
}
