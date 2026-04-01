import * as Y from 'yjs';
import {
  findHeadingByText,
  findNodeById,
  getSectionBoundaries,
} from './fragment-utils';

export type IdentifierType = 'text' | 'id';

interface ResolvedTarget {
  index: number;
  element: Y.XmlElement;
  level?: number;
}

/**
 * Resolve a section identifier to a fragment element.
 * Throws descriptive errors for not-found and ambiguous matches.
 */
function resolveIdentifier(
  fragment: Y.XmlFragment,
  identifier: string,
  identifierType: IdentifierType,
): ResolvedTarget {
  if (identifierType === 'id') {
    const result = findNodeById(fragment, identifier);
    if (!result) {
      throw new IdentifierNotFoundError(
        `Node with id "${identifier}" not found`,
        identifier,
        identifierType,
      );
    }
    const level =
      result.element.nodeName === 'heading'
        ? Number(result.element.getAttribute('level') ?? 1)
        : undefined;
    return { ...result, level };
  }

  // identifierType === 'text'
  const matches = findHeadingByText(fragment, identifier);
  if (matches.length === 0) {
    throw new IdentifierNotFoundError(
      `Heading with text "${identifier}" not found`,
      identifier,
      identifierType,
    );
  }
  if (matches.length > 1) {
    throw new AmbiguousIdentifierError(
      `Ambiguous: ${matches.length} headings match "${identifier}". Use identifierType: "id" for precision.`,
      identifier,
      matches.length,
    );
  }
  return matches[0];
}

/**
 * Replace the content of a section (everything between a heading
 * and the next heading of the same or higher level).
 * The heading itself is preserved; only its body content is replaced.
 */
export function replaceSectionContent(
  fragment: Y.XmlFragment,
  identifier: string,
  identifierType: IdentifierType,
  newElements: (Y.XmlElement | Y.XmlText)[],
): void {
  const target = resolveIdentifier(fragment, identifier, identifierType);
  const level = target.level ?? 1;
  const { contentStart, contentLength } = getSectionBoundaries(
    fragment,
    target.index,
    level,
  );

  // Delete existing section content
  if (contentLength > 0) {
    fragment.delete(contentStart, contentLength);
  }

  // Insert new content at the same position
  if (newElements.length > 0) {
    fragment.insert(contentStart, newElements);
  }
}

/**
 * Insert content after a specific node (heading or any node identified by ID).
 */
export function insertAfterNode(
  fragment: Y.XmlFragment,
  identifier: string,
  identifierType: IdentifierType,
  newElements: (Y.XmlElement | Y.XmlText)[],
): void {
  const target = resolveIdentifier(fragment, identifier, identifierType);
  const insertPosition = target.index + 1;

  if (newElements.length > 0) {
    fragment.insert(insertPosition, newElements);
  }
}

/**
 * Thrown when the specified identifier cannot be found in the fragment.
 */
export class IdentifierNotFoundError extends Error {
  constructor(
    message: string,
    public readonly identifier: string,
    public readonly identifierType: IdentifierType,
  ) {
    super(message);
    this.name = 'IdentifierNotFoundError';
  }
}

/**
 * Thrown when multiple headings match the given text identifier.
 */
export class AmbiguousIdentifierError extends Error {
  constructor(
    message: string,
    public readonly identifier: string,
    public readonly matchCount: number,
  ) {
    super(message);
    this.name = 'AmbiguousIdentifierError';
  }
}
