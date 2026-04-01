import * as Y from 'yjs';
import {
  replaceSectionContent,
  insertAfterNode,
  IdentifierNotFoundError,
  AmbiguousIdentifierError,
} from '../section-ops';
import { extractTextFromYNode } from '../fragment-utils';
import { createTestDoc, makeParagraph } from './yjs-test-helpers';

function getFullText(fragment: Y.XmlFragment): string {
  let text = '';
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
      text += extractTextFromYNode(child);
    }
  }
  return text;
}

function getNodeTexts(fragment: Y.XmlFragment): string[] {
  const texts: string[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
      texts.push(extractTextFromYNode(child));
    }
  }
  return texts;
}

const standardContent = [
  {
    type: 'heading',
    attrs: { level: 1, id: 'h1-intro' },
    content: [{ type: 'text', text: 'Introduction' }],
  },
  {
    type: 'paragraph',
    attrs: { id: 'p-intro' },
    content: [{ type: 'text', text: 'Intro paragraph.' }],
  },
  {
    type: 'heading',
    attrs: { level: 2, id: 'h2-details' },
    content: [{ type: 'text', text: 'Details' }],
  },
  {
    type: 'paragraph',
    attrs: { id: 'p-details' },
    content: [{ type: 'text', text: 'Detail paragraph.' }],
  },
  {
    type: 'heading',
    attrs: { level: 1, id: 'h1-conclusion' },
    content: [{ type: 'text', text: 'Conclusion' }],
  },
  {
    type: 'paragraph',
    attrs: { id: 'p-conclusion' },
    content: [{ type: 'text', text: 'Conclusion paragraph.' }],
  },
];

describe('section-ops', () => {
  describe('replaceSectionContent', () => {
    it('replaces content under a heading identified by text', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Replaced introduction content.');

      replaceSectionContent(fragment, 'Introduction', 'text', [newPara]);

      const texts = getNodeTexts(fragment);
      // Heading preserved
      expect(texts[0]).toBe('Introduction');
      // Old body (paragraph, H2 sub-section, paragraph) replaced with single new paragraph
      expect(texts[1]).toBe('Replaced introduction content.');
      // Conclusion section follows
      expect(getFullText(fragment)).toContain('Conclusion');
    });

    it('replaces content under a heading identified by node ID', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('New details here.');

      replaceSectionContent(fragment, 'h2-details', 'id', [newPara]);

      const fullText = getFullText(fragment);
      expect(fullText).toContain('New details here.');
      expect(fullText).not.toContain('Detail paragraph.');
      // Heading preserved
      expect(fullText).toContain('Details');
      // Conclusion still present
      expect(fullText).toContain('Conclusion');
    });

    it('throws IdentifierNotFoundError when heading text is not found', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Will not be inserted.');

      expect(() => {
        replaceSectionContent(fragment, 'Nonexistent', 'text', [newPara]);
      }).toThrow(IdentifierNotFoundError);
    });

    it('throws IdentifierNotFoundError when node ID is not found', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Will not be inserted.');

      expect(() => {
        replaceSectionContent(fragment, 'no-such-id', 'id', [newPara]);
      }).toThrow(IdentifierNotFoundError);
    });

    it('throws AmbiguousIdentifierError for duplicate heading text', () => {
      const content = [
        {
          type: 'heading',
          attrs: { level: 1, id: 'dup-1' },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First body.' }],
        },
        {
          type: 'heading',
          attrs: { level: 1, id: 'dup-2' },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second body.' }],
        },
      ];
      const fragment = createTestDoc(content);
      const newPara = makeParagraph('Ambiguous replacement.');

      expect(() => {
        replaceSectionContent(fragment, 'Section', 'text', [newPara]);
      }).toThrow(AmbiguousIdentifierError);

      try {
        replaceSectionContent(fragment, 'Section', 'text', [newPara]);
      } catch (e) {
        expect(e).toBeInstanceOf(AmbiguousIdentifierError);
        expect((e as AmbiguousIdentifierError).matchCount).toBe(2);
        expect((e as AmbiguousIdentifierError).identifier).toBe('Section');
      }
    });

    it('handles section at end of document (no subsequent heading)', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('New conclusion content.');

      replaceSectionContent(fragment, 'Conclusion', 'text', [newPara]);

      const fullText = getFullText(fragment);
      expect(fullText).toContain('New conclusion content.');
      expect(fullText).not.toContain('Conclusion paragraph.');
      // Heading preserved
      expect(fullText).toContain('Conclusion');
    });

    it('replaces with multiple new elements', () => {
      const fragment = createTestDoc(standardContent);
      const para1 = makeParagraph('First new paragraph.');
      const para2 = makeParagraph('Second new paragraph.');

      replaceSectionContent(fragment, 'Conclusion', 'text', [para1, para2]);

      const fullText = getFullText(fragment);
      expect(fullText).toContain('First new paragraph.');
      expect(fullText).toContain('Second new paragraph.');
    });

    it('replaces with empty array (deletes section content)', () => {
      const fragment = createTestDoc(standardContent);

      replaceSectionContent(fragment, 'Conclusion', 'text', []);

      const fullText = getFullText(fragment);
      expect(fullText).toContain('Conclusion');
      expect(fullText).not.toContain('Conclusion paragraph.');
    });
  });

  describe('insertAfterNode', () => {
    it('inserts content after a heading identified by text', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Inserted after Introduction heading.');

      insertAfterNode(fragment, 'Introduction', 'text', [newPara]);

      const texts = getNodeTexts(fragment);
      expect(texts[0]).toBe('Introduction');
      expect(texts[1]).toBe('Inserted after Introduction heading.');
      // Original intro paragraph pushed to index 2
      expect(texts[2]).toBe('Intro paragraph.');
    });

    it('inserts content after a heading identified by node ID', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Inserted after Details heading.');

      insertAfterNode(fragment, 'h2-details', 'id', [newPara]);

      const texts = getNodeTexts(fragment);
      const detailsIdx = texts.indexOf('Details');
      expect(detailsIdx).toBeGreaterThan(-1);
      expect(texts[detailsIdx + 1]).toBe('Inserted after Details heading.');
    });

    it('throws IdentifierNotFoundError when heading text is not found', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Will not be inserted.');

      expect(() => {
        insertAfterNode(fragment, 'Nonexistent', 'text', [newPara]);
      }).toThrow(IdentifierNotFoundError);
    });

    it('throws IdentifierNotFoundError when node ID is not found', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Will not be inserted.');

      expect(() => {
        insertAfterNode(fragment, 'no-such-id', 'id', [newPara]);
      }).toThrow(IdentifierNotFoundError);
    });

    it('throws AmbiguousIdentifierError for duplicate heading text', () => {
      const content = [
        {
          type: 'heading',
          attrs: { level: 1, id: 'dup-a' },
          content: [{ type: 'text', text: 'Duplicate' }],
        },
        {
          type: 'heading',
          attrs: { level: 1, id: 'dup-b' },
          content: [{ type: 'text', text: 'Duplicate' }],
        },
      ];
      const fragment = createTestDoc(content);
      const newPara = makeParagraph('After which one?');

      expect(() => {
        insertAfterNode(fragment, 'Duplicate', 'text', [newPara]);
      }).toThrow(AmbiguousIdentifierError);
    });

    it('inserts after a paragraph identified by ID', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Inserted after intro paragraph.');

      insertAfterNode(fragment, 'p-intro', 'id', [newPara]);

      const texts = getNodeTexts(fragment);
      const introParaIdx = texts.indexOf('Intro paragraph.');
      expect(introParaIdx).toBeGreaterThan(-1);
      expect(texts[introParaIdx + 1]).toBe('Inserted after intro paragraph.');
    });

    it('inserts multiple elements in order', () => {
      const fragment = createTestDoc(standardContent);
      const para1 = makeParagraph('First inserted.');
      const para2 = makeParagraph('Second inserted.');

      insertAfterNode(fragment, 'Conclusion', 'text', [para1, para2]);

      const texts = getNodeTexts(fragment);
      const conclusionIdx = texts.indexOf('Conclusion');
      expect(texts[conclusionIdx + 1]).toBe('First inserted.');
      expect(texts[conclusionIdx + 2]).toBe('Second inserted.');
    });

    it('inserts at end of document when target is the last node', () => {
      const fragment = createTestDoc(standardContent);
      const newPara = makeParagraph('Very last element.');

      insertAfterNode(fragment, 'p-conclusion', 'id', [newPara]);

      const texts = getNodeTexts(fragment);
      expect(texts[texts.length - 1]).toBe('Very last element.');
    });
  });

  describe('error class properties', () => {
    it('IdentifierNotFoundError has correct properties', () => {
      const err = new IdentifierNotFoundError(
        'Not found',
        'my-id',
        'id',
      );
      expect(err.name).toBe('IdentifierNotFoundError');
      expect(err.identifier).toBe('my-id');
      expect(err.identifierType).toBe('id');
      expect(err.message).toBe('Not found');
      expect(err).toBeInstanceOf(Error);
    });

    it('AmbiguousIdentifierError has correct properties', () => {
      const err = new AmbiguousIdentifierError(
        'Ambiguous',
        'Section Title',
        3,
      );
      expect(err.name).toBe('AmbiguousIdentifierError');
      expect(err.identifier).toBe('Section Title');
      expect(err.matchCount).toBe(3);
      expect(err.message).toBe('Ambiguous');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
