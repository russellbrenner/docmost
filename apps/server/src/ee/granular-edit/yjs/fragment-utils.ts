import * as Y from 'yjs';

/**
 * Extract plain text from a Y.XmlElement or Y.XmlText recursively.
 */
export function extractTextFromYNode(
  node: Y.XmlElement | Y.XmlText,
): string {
  if (node instanceof Y.XmlText) {
    return node.toString();
  }

  let text = '';
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i);
    if (child instanceof Y.XmlText) {
      text += child.toString();
    } else if (child instanceof Y.XmlElement) {
      text += extractTextFromYNode(child);
    }
  }
  return text;
}

/**
 * Find headings in the fragment matching the given text content.
 * Returns all matches with their index, element, and heading level.
 */
export function findHeadingByText(
  fragment: Y.XmlFragment,
  text: string,
): { index: number; element: Y.XmlElement; level: number }[] {
  const matches: { index: number; element: Y.XmlElement; level: number }[] = [];

  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement && child.nodeName === 'heading') {
      const headingText = extractTextFromYNode(child).trim();
      if (headingText === text) {
        const level = child.getAttribute('level') ?? 1;
        matches.push({ index: i, element: child, level: Number(level) });
      }
    }
  }

  return matches;
}

/**
 * Find any element in the fragment by its UniqueID attribute.
 * This is the nanoid-based ID assigned by the UniqueID extension.
 */
export function findNodeById(
  fragment: Y.XmlFragment,
  nodeId: string,
): { index: number; element: Y.XmlElement } | null {
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement) {
      if (child.getAttribute('id') === nodeId) {
        return { index: i, element: child };
      }
    }
  }
  return null;
}

/**
 * Get section boundaries starting from a heading.
 * A section starts after the heading and ends at the next heading
 * of the same or higher (lower number) level, or end of fragment.
 *
 * @returns contentStart - index of the first content node after the heading
 * @returns contentLength - number of content nodes in the section body
 */
export function getSectionBoundaries(
  fragment: Y.XmlFragment,
  headingIndex: number,
  headingLevel: number,
): { contentStart: number; contentLength: number } {
  const contentStart = headingIndex + 1;
  let contentLength = 0;

  for (let i = contentStart; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement && child.nodeName === 'heading') {
      const childLevel = Number(child.getAttribute('level') ?? 1);
      if (childLevel <= headingLevel) {
        break;
      }
    }
    contentLength++;
  }

  return { contentStart, contentLength };
}
