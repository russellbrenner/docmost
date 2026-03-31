import { TiptapTransformer } from '@hocuspocus/transformer';
import { tiptapExtensions } from '../../../../collaboration/collaboration.util';
import * as Y from 'yjs';
import {
  extractTextFromYNode,
  findHeadingByText,
  findNodeById,
  getSectionBoundaries,
} from '../fragment-utils';

function createTestDoc(content: any[]): Y.XmlFragment {
  const pmJson = { type: 'doc', content };
  const ydoc = TiptapTransformer.toYdoc(pmJson, 'default', tiptapExtensions);
  return ydoc.getXmlFragment('default');
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
    content: [{ type: 'text', text: 'This is the introduction paragraph.' }],
  },
  {
    type: 'heading',
    attrs: { level: 2, id: 'h2-details' },
    content: [{ type: 'text', text: 'Details' }],
  },
  {
    type: 'paragraph',
    attrs: { id: 'p-details' },
    content: [{ type: 'text', text: 'Some detail text here.' }],
  },
  {
    type: 'heading',
    attrs: { level: 1, id: 'h1-conclusion' },
    content: [{ type: 'text', text: 'Conclusion' }],
  },
  {
    type: 'paragraph',
    attrs: { id: 'p-conclusion' },
    content: [{ type: 'text', text: 'Final thoughts on the topic.' }],
  },
];

describe('fragment-utils', () => {
  describe('extractTextFromYNode', () => {
    it('extracts text from a simple paragraph element', () => {
      const fragment = createTestDoc([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ]);
      const child = fragment.get(0) as Y.XmlElement;
      expect(extractTextFromYNode(child)).toBe('Hello world');
    });

    it('extracts text from a Y.XmlText node', () => {
      const ytext = new Y.XmlText();
      ytext.insert(0, 'Plain text node');
      expect(extractTextFromYNode(ytext)).toBe('Plain text node');
    });

    it('concatenates text from multiple child text nodes', () => {
      const fragment = createTestDoc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            {
              type: 'text',
              text: 'bold world',
              marks: [{ type: 'bold' }],
            },
          ],
        },
      ]);
      const child = fragment.get(0) as Y.XmlElement;
      const text = extractTextFromYNode(child);
      expect(text).toContain('Hello');
      expect(text).toContain('bold world');
    });

    it('extracts text from a heading element', () => {
      const fragment = createTestDoc([
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'My Heading' }],
        },
      ]);
      const child = fragment.get(0) as Y.XmlElement;
      expect(extractTextFromYNode(child)).toBe('My Heading');
    });

    it('returns empty string for an element with no text', () => {
      const element = new Y.XmlElement('paragraph');
      expect(extractTextFromYNode(element)).toBe('');
    });
  });

  describe('findHeadingByText', () => {
    it('finds a heading by exact text match', () => {
      const fragment = createTestDoc(standardContent);
      const matches = findHeadingByText(fragment, 'Introduction');
      expect(matches).toHaveLength(1);
      expect(matches[0].level).toBe(1);
      expect(matches[0].element.nodeName).toBe('heading');
    });

    it('returns empty array when no heading matches', () => {
      const fragment = createTestDoc(standardContent);
      const matches = findHeadingByText(fragment, 'Nonexistent Heading');
      expect(matches).toHaveLength(0);
    });

    it('returns multiple matches for duplicate heading text', () => {
      const content = [
        {
          type: 'heading',
          attrs: { level: 1, id: 'dup-1' },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First section body.' }],
        },
        {
          type: 'heading',
          attrs: { level: 1, id: 'dup-2' },
          content: [{ type: 'text', text: 'Section' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second section body.' }],
        },
      ];
      const fragment = createTestDoc(content);
      const matches = findHeadingByText(fragment, 'Section');
      expect(matches).toHaveLength(2);
      expect(matches[0].index).toBeLessThan(matches[1].index);
    });

    it('does not match paragraph text', () => {
      const fragment = createTestDoc([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Introduction' }],
        },
      ]);
      const matches = findHeadingByText(fragment, 'Introduction');
      expect(matches).toHaveLength(0);
    });

    it('returns correct heading level for different levels', () => {
      const fragment = createTestDoc(standardContent);
      const matches = findHeadingByText(fragment, 'Details');
      expect(matches).toHaveLength(1);
      expect(matches[0].level).toBe(2);
    });
  });

  describe('findNodeById', () => {
    it('finds a node by its UniqueID attribute', () => {
      const fragment = createTestDoc(standardContent);
      const result = findNodeById(fragment, 'h1-intro');
      expect(result).not.toBeNull();
      expect(result!.element.nodeName).toBe('heading');
    });

    it('finds a paragraph by its UniqueID attribute', () => {
      const fragment = createTestDoc(standardContent);
      const result = findNodeById(fragment, 'p-details');
      expect(result).not.toBeNull();
      expect(result!.element.nodeName).toBe('paragraph');
    });

    it('returns null for non-existent ID', () => {
      const fragment = createTestDoc(standardContent);
      const result = findNodeById(fragment, 'does-not-exist');
      expect(result).toBeNull();
    });

    it('returns the correct index for each node', () => {
      const fragment = createTestDoc(standardContent);

      const intro = findNodeById(fragment, 'h1-intro');
      const details = findNodeById(fragment, 'h2-details');
      const conclusion = findNodeById(fragment, 'h1-conclusion');

      expect(intro).not.toBeNull();
      expect(details).not.toBeNull();
      expect(conclusion).not.toBeNull();
      expect(intro!.index).toBeLessThan(details!.index);
      expect(details!.index).toBeLessThan(conclusion!.index);
    });
  });

  describe('getSectionBoundaries', () => {
    it('returns correct boundaries for a section between same-level headings', () => {
      const fragment = createTestDoc(standardContent);
      // H1 "Introduction" is at index 0, next H1 "Conclusion" is at index 4
      // Section content: paragraph (idx 1), H2 "Details" (idx 2), paragraph (idx 3)
      const bounds = getSectionBoundaries(fragment, 0, 1);
      expect(bounds.contentStart).toBe(1);
      // Content includes paragraph, H2 heading, and H2's paragraph (H2 < H1 so doesn't break)
      expect(bounds.contentLength).toBe(3);
    });

    it('returns correct boundaries for a subsection (H2 under H1)', () => {
      const fragment = createTestDoc(standardContent);
      // H2 "Details" at index 2, next heading at same-or-higher level is H1 "Conclusion" at index 4
      const bounds = getSectionBoundaries(fragment, 2, 2);
      expect(bounds.contentStart).toBe(3);
      expect(bounds.contentLength).toBe(1);
    });

    it('extends to end of document for the last section', () => {
      const fragment = createTestDoc(standardContent);
      // H1 "Conclusion" is at index 4, followed only by paragraph at index 5
      const bounds = getSectionBoundaries(fragment, 4, 1);
      expect(bounds.contentStart).toBe(5);
      expect(bounds.contentLength).toBe(1);
    });

    it('returns zero content length for heading with no body', () => {
      const content = [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Second' }],
        },
      ];
      const fragment = createTestDoc(content);
      const bounds = getSectionBoundaries(fragment, 0, 1);
      expect(bounds.contentStart).toBe(1);
      expect(bounds.contentLength).toBe(0);
    });

    it('includes sub-headings of lower priority in the section', () => {
      const content = [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Top' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Sub' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Sub content.' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'SubSub' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Deep content.' }],
        },
      ];
      const fragment = createTestDoc(content);
      // H1 at index 0 owns everything after it since there is no subsequent H1
      const bounds = getSectionBoundaries(fragment, 0, 1);
      expect(bounds.contentStart).toBe(1);
      expect(bounds.contentLength).toBe(4);
    });
  });
});
