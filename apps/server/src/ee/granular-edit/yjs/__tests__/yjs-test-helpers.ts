/**
 * Test helpers for building Y.XmlFragment documents without importing the
 * full editor extension chain (which pulls in ESM-only packages that Jest
 * cannot transform out-of-the-box).
 *
 * These helpers construct Yjs XML structures that match what TiptapTransformer
 * would produce from ProseMirror JSON.
 */
import * as Y from 'yjs';

interface ProsemirrorNode {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: ProsemirrorNode[];
  marks?: { type: string; attrs?: Record<string, any> }[];
}

/**
 * Convert a ProseMirror-style node descriptor into a Yjs XmlElement or XmlText.
 * Mirrors the behaviour of prosemirrorNodeToYElement from collaboration.util.
 */
export function pmNodeToYElement(node: ProsemirrorNode): Y.XmlElement | Y.XmlText {
  if (node.type === 'text') {
    const ytext = new Y.XmlText();
    ytext.insert(0, node.text || '');
    if (node.marks?.length) {
      const attrs: Record<string, any> = {};
      for (const mark of node.marks) {
        attrs[mark.type] = mark.attrs || true;
      }
      ytext.format(0, node.text?.length || 0, attrs);
    }
    return ytext;
  }

  const element = new Y.XmlElement(node.type);
  if (node.attrs) {
    for (const [key, value] of Object.entries(node.attrs)) {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value as any);
      }
    }
  }
  if (node.content?.length) {
    const children = node.content.map(pmNodeToYElement);
    element.insert(0, children);
  }
  return element;
}

/**
 * Build a Y.XmlFragment inside a new Y.Doc from ProseMirror-style content
 * array. The fragment behaves identically to what TiptapTransformer.toYdoc
 * produces for the 'default' fragment key.
 */
export function createTestDoc(content: ProsemirrorNode[]): Y.XmlFragment {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('default');
  const elements = content.map(pmNodeToYElement);
  fragment.insert(0, elements);
  return fragment;
}

/**
 * Create a paragraph Y.XmlElement for insertion tests.
 */
export function makeParagraph(text: string): Y.XmlElement | Y.XmlText {
  return pmNodeToYElement({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
}
