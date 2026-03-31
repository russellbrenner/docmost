import { TiptapTransformer } from '@hocuspocus/transformer';
import { tiptapExtensions } from '../../../../collaboration/collaboration.util';
import * as Y from 'yjs';
import {
  findAndReplaceInFragment,
  FindReplaceResult,
} from '../find-replace';
import { extractTextFromYNode } from '../fragment-utils';

function createTestDoc(content: any[]): Y.XmlFragment {
  const pmJson = { type: 'doc', content };
  const ydoc = TiptapTransformer.toYdoc(pmJson, 'default', tiptapExtensions);
  return ydoc.getXmlFragment('default');
}

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

describe('findAndReplaceInFragment', () => {
  it('replaces a single occurrence by default', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'The quick brown fox jumps over the lazy dog.' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'quick', 'slow');
    expect(result.matchCount).toBe(1);
    expect(result.replacedCount).toBe(1);
    expect(getFullText(fragment)).toContain('slow');
    expect(getFullText(fragment)).not.toContain('quick');
  });

  it('replaces all occurrences when occurrence is -1', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'foo bar foo baz foo' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'foo', 'qux', false, -1);
    expect(result.matchCount).toBe(3);
    expect(result.replacedCount).toBe(3);
    expect(getFullText(fragment)).toBe('qux bar qux baz qux');
  });

  it('replaces a specific occurrence (2nd)', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'aaa bbb aaa ccc aaa' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'aaa', 'ZZZ', false, 2);
    expect(result.replacedCount).toBe(1);
    const text = getFullText(fragment);
    // First 'aaa' should remain, second should be replaced
    expect(text).toBe('aaa bbb ZZZ ccc aaa');
  });

  it('performs case-insensitive search when matchCase is false', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello HELLO hello' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'hello', 'hi', false, -1);
    expect(result.matchCount).toBe(3);
    expect(result.replacedCount).toBe(3);
    expect(getFullText(fragment)).toBe('hi hi hi');
  });

  it('performs case-sensitive search when matchCase is true', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello HELLO hello' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'Hello', 'Hi', true, -1);
    expect(result.matchCount).toBe(1);
    expect(result.replacedCount).toBe(1);
    const text = getFullText(fragment);
    expect(text).toContain('Hi');
    expect(text).toContain('HELLO');
    expect(text).toContain('hello');
  });

  it('returns zero counts when text is not found', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Nothing special here.' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'missing', 'found');
    expect(result.matchCount).toBe(0);
    expect(result.replacedCount).toBe(0);
    expect(getFullText(fragment)).toBe('Nothing special here.');
  });

  it('replaces text with empty string (deletion)', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Remove this word please.' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'this ', '', false, 1);
    expect(result.replacedCount).toBe(1);
    expect(getFullText(fragment)).toBe('Remove word please.');
  });

  it('replaces text with longer text', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'short' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'short', 'a much longer replacement string');
    expect(result.replacedCount).toBe(1);
    expect(getFullText(fragment)).toBe('a much longer replacement string');
  });

  it('replaces text with shorter text', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'a very long original text' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'a very long original text', 'tiny');
    expect(result.replacedCount).toBe(1);
    expect(getFullText(fragment)).toBe('tiny');
  });

  it('replaces across multiple paragraphs', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'First target paragraph.' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Second target paragraph.' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'target', 'updated', false, -1);
    expect(result.matchCount).toBe(2);
    expect(result.replacedCount).toBe(2);
    const text = getFullText(fragment);
    expect(text).toContain('First updated');
    expect(text).toContain('Second updated');
  });

  it('replaces only the first occurrence when occurrence is 1', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'apple apple apple' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'apple', 'orange', false, 1);
    expect(result.replacedCount).toBe(1);
    // matchCount stops counting after replacement for specific occurrence
    expect(result.matchCount).toBe(1);
    expect(getFullText(fragment)).toBe('orange apple apple');
  });

  it('handles replacement text containing the search text', () => {
    const fragment = createTestDoc([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'ab ab' }],
      },
    ]);

    const result = findAndReplaceInFragment(fragment, 'ab', 'abc', false, -1);
    expect(result.matchCount).toBe(2);
    expect(result.replacedCount).toBe(2);
    expect(getFullText(fragment)).toBe('abc abc');
  });
});
