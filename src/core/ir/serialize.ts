import {
  IRDocument,
  IRBlockNode,
  IRSectionNode,
  IRParagraphNode,
  IRListNode,
  IRTableNode,
  IRDiagramNode,
  IRCodeNode,
  IRImageNode,
  IRFrontmatterNode,
  IRPageBreakNode,
  IRTocNode,
  IRFootnoteNode,
  IRReferenceNode,
  IRQuoteNode,
  IRSlideNode,
  IRMathNode,
} from '../../shared/types';

export function serializeIR(doc: IRDocument): string {
  const lines: string[] = [];

  if (doc.title) {
    lines.push(`# ${doc.title}`);
    lines.push('');
  }

  for (const child of doc.children) {
    lines.push(serializeNode(child));
  }

  return lines.join('\n');
}

function serializeNode(node: IRBlockNode): string {
  switch (node.type) {
    case 'section':
      return serializeSection(node as IRSectionNode);
    case 'paragraph':
      return serializeParagraph(node as IRParagraphNode);
    case 'list':
      return serializeList(node as IRListNode);
    case 'table':
      return serializeTable(node as IRTableNode);
    case 'diagram':
      return serializeDiagram(node as IRDiagramNode);
    case 'code':
      return serializeCode(node as IRCodeNode);
    case 'image':
      return serializeImage(node as IRImageNode);
    case 'frontmatter':
      return serializeFrontmatter(node as IRFrontmatterNode);
    case 'pageBreak':
      return '---\n';
    case 'toc':
      return '[Table of Contents]';
    case 'footnote':
      return serializeFootnote(node as IRFootnoteNode);
    case 'reference':
      return serializeReference(node as IRReferenceNode);
    case 'quote':
      return serializeQuote(node as IRQuoteNode);
    case 'slide':
      return serializeSlide(node as IRSlideNode);
    case 'math':
      return serializeMath(node as IRMathNode);
    default:
      return '';
  }
}

function serializeSection(node: IRSectionNode): string {
  const prefix = '#'.repeat(node.level);
  const lines = [`${prefix} ${node.title}`, ''];
  for (const child of node.children) {
    lines.push(serializeNode(child));
  }
  return lines.join('\n');
}

function serializeParagraph(node: IRParagraphNode): string {
  return `${node.content}\n`;
}

function serializeList(node: IRListNode): string {
  return node.items
    .map((item, i) => {
      const prefix = node.ordered ? `${i + 1}. ` : '- ';
      return `${prefix}${item.content}`;
    })
    .join('\n') + '\n';
}

function serializeTable(node: IRTableNode): string {
  const lines: string[] = [];
  lines.push(`| ${node.headers.join(' | ')} |`);
  lines.push(`| ${node.headers.map(() => '---').join(' | ')} |`);
  for (const row of node.rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

function serializeDiagram(node: IRDiagramNode): string {
  return `\`\`\`${node.engine}\n${node.content}\n\`\`\`\n`;
}

function serializeCode(node: IRCodeNode): string {
  return `\`\`\`${node.language}\n${node.content}\n\`\`\`\n`;
}

function serializeImage(node: IRImageNode): string {
  return `![${node.alt || ''}](${node.src})\n`;
}

function serializeFrontmatter(node: IRFrontmatterNode): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(node.data)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function serializeFootnote(node: IRFootnoteNode): string {
  return `[^${node.label}]: ${node.content}\n`;
}

function serializeReference(node: IRReferenceNode): string {
  return `[${node.label}]: ${node.content}\n`;
}

function serializeQuote(node: IRQuoteNode): string {
  const lines = node.content.split('\n').map((line) => `> ${line}`);
  if (node.author) {
    lines.push(`> — ${node.author}`);
  }
  return lines.join('\n') + '\n';
}

function serializeSlide(node: IRSlideNode): string {
  const lines = [`## ${node.title}`, ''];
  for (const child of node.children) {
    lines.push(serializeNode(child));
  }
  return lines.join('\n') + '\n';
}

function serializeMath(node: IRMathNode): string {
  return node.inline ? `$${node.content}$` : `$$\n${node.content}\n$$`;
}
