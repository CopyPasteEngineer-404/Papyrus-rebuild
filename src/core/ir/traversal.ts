import { IRDocument, IRBlockNode, IRNode, IRSectionNode } from '../../shared/types';

export type Visitor = (node: IRNode) => void;

export function walkIR(doc: IRDocument, visitor: Visitor): void {
  visitor(doc);
  for (const child of doc.children) {
    walkNode(child, visitor);
  }
}

function walkNode(node: IRBlockNode, visitor: Visitor): void {
  visitor(node);

  if (node.type === 'section') {
    const section = node as IRSectionNode;
    for (const child of section.children) {
      walkNode(child, visitor);
    }
  }

  if (node.type === 'slide') {
    const slide = node as any;
    if (Array.isArray(slide.children)) {
      for (const child of slide.children) {
        walkNode(child, visitor);
      }
    }
  }
}

export function findNodesByType(doc: IRDocument, type: string): IRNode[] {
  const results: IRNode[] = [];
  walkIR(doc, (node) => {
    if (node.type === type) {
      results.push(node);
    }
  });
  return results;
}

export function countNodesByType(doc: IRDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  walkIR(doc, (node) => {
    counts[node.type] = (counts[node.type] || 0) + 1;
  });
  return counts;
}

export function extractHeadings(doc: IRDocument): { level: number; title: string }[] {
  const headings: { level: number; title: string }[] = [];
  walkIR(doc, (node) => {
    if (node.type === 'section') {
      const section = node as IRSectionNode;
      headings.push({ level: section.level, title: section.title });
    }
  });
  return headings;
}

export function flattenChildren(doc: IRDocument): IRBlockNode[] {
  const result: IRBlockNode[] = [];
  for (const child of doc.children) {
    result.push(child);
    if (child.type === 'section') {
      const section = child as IRSectionNode;
      result.push(...flattenSectionChildren(section));
    }
  }
  return result;
}

function flattenSectionChildren(section: IRSectionNode): IRBlockNode[] {
  const result: IRBlockNode[] = [];
  for (const child of section.children) {
    result.push(child);
    if (child.type === 'section') {
      result.push(...flattenSectionChildren(child as IRSectionNode));
    }
  }
  return result;
}
