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
  IRInlineNode,
  IRSource,
  IR_VERSION,
} from '../../shared/types';
import { generateId } from '../../shared/utils';

export class IRBuilder {
  private title: string = '';
  private children: IRBlockNode[] = [];
  private frontmatter?: Record<string, unknown>;
  private sourceFile: string = '';

  setSourceFile(file: string): this {
    this.sourceFile = file;
    return this;
  }

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setFrontmatter(data: Record<string, unknown>): this {
    this.frontmatter = data;
    return this;
  }

  addParagraph(content: string, inline?: IRInlineNode[], source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'paragraph',
      content,
      inline,
      source,
    });
    return this;
  }

  addSection(level: number, title: string, source?: IRSource): SectionBuilder {
    const section: IRSectionNode = {
      id: generateId(),
      type: 'section',
      level,
      title,
      children: [],
      source,
    };
    this.children.push(section);
    return new SectionBuilder(this, section);
  }

  addList(ordered: boolean, items: { content: string; inline?: IRInlineNode[]; children?: IRBlockNode[] }[], source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'list',
      ordered,
      items,
      source,
    });
    return this;
  }

  addTable(headers: string[], rows: string[][], source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'table',
      headers,
      rows,
      source,
    });
    return this;
  }

  addDiagram(content: string, engine: 'mermaid' | 'unknown' = 'mermaid', source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'diagram',
      content,
      engine,
      source,
    });
    return this;
  }

  addCode(language: string, content: string, source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'code',
      language,
      content,
      source,
    });
    return this;
  }

  addImage(src: string, alt?: string, source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'image',
      src,
      alt,
      source,
    });
    return this;
  }

  addFrontmatter(data: Record<string, unknown>, source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'frontmatter',
      data,
      source,
    });
    return this;
  }

  addPageBreak(source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'pageBreak',
      source,
    });
    return this;
  }

  addToc(source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'toc',
      source,
    });
    return this;
  }

  addFootnote(label: string, content: string, source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'footnote',
      label,
      content,
      source,
    });
    return this;
  }

  addReference(label: string, content: string, source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'reference',
      label,
      content,
      source,
    });
    return this;
  }

  addQuote(content: string, author?: string, inline?: IRInlineNode[], source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'quote',
      content,
      inline,
      author,
      source,
    });
    return this;
  }

  addSlide(title: string, source?: IRSource): SlideBuilder {
    const slide: IRSlideNode = {
      id: generateId(),
      type: 'slide',
      title,
      children: [],
      source,
    };
    this.children.push(slide);
    return new SlideBuilder(this, slide);
  }

  addMath(content: string, inline: boolean = false, source?: IRSource): this {
    this.children.push({
      id: generateId(),
      type: 'math',
      content,
      inline,
      source,
    });
    return this;
  }

  addRawNode(node: IRBlockNode): this {
    this.children.push(node);
    return this;
  }

  build(): IRDocument {
    return {
      id: generateId(),
      type: 'document',
      version: IR_VERSION,
      title: this.title,
      children: this.children,
      frontmatter: this.frontmatter,
      createdAt: new Date().toISOString(),
      source: this.sourceFile ? {
        file: this.sourceFile,
        lineStart: 1,
        lineEnd: 1,
      } : undefined,
    };
  }
}

export class SectionBuilder {
  private parent: IRBuilder;
  private section: IRSectionNode;

  constructor(parent: IRBuilder, section: IRSectionNode) {
    this.parent = parent;
    this.section = section;
  }

  addParagraph(content: string, inline?: IRInlineNode[], source?: IRSource): this {
    this.section.children.push({
      id: generateId(),
      type: 'paragraph',
      content,
      inline,
      source,
    });
    return this;
  }

  addSection(level: number, title: string, source?: IRSource): SectionBuilder {
    const child: IRSectionNode = {
      id: generateId(),
      type: 'section',
      level,
      title,
      children: [],
      source,
    };
    this.section.children.push(child);
    return new SectionBuilder(this.parent, child);
  }

  addList(ordered: boolean, items: { content: string; inline?: IRInlineNode[]; children?: IRBlockNode[] }[], source?: IRSource): this {
    this.section.children.push({
      id: generateId(),
      type: 'list',
      ordered,
      items,
      source,
    });
    return this;
  }

  addTable(headers: string[], rows: string[][], source?: IRSource): this {
    this.section.children.push({
      id: generateId(),
      type: 'table',
      headers,
      rows,
      source,
    });
    return this;
  }

  addCode(language: string, content: string, source?: IRSource): this {
    this.section.children.push({
      id: generateId(),
      type: 'code',
      language,
      content,
      source,
    });
    return this;
  }

  addDiagram(content: string, engine: 'mermaid' | 'unknown' = 'mermaid', source?: IRSource): this {
    this.section.children.push({
      id: generateId(),
      type: 'diagram',
      content,
      engine,
      source,
    });
    return this;
  }

  addQuote(content: string, author?: string, inline?: IRInlineNode[], source?: IRSource): this {
    this.section.children.push({
      id: generateId(),
      type: 'quote',
      content,
      inline,
      author,
      source,
    });
    return this;
  }

  done(): IRBuilder {
    return this.parent;
  }

  build(): IRDocument {
    return this.parent.build();
  }
}

export class SlideBuilder {
  private parent: IRBuilder;
  private slide: IRSlideNode;

  constructor(parent: IRBuilder, slide: IRSlideNode) {
    this.parent = parent;
    this.slide = slide;
  }

  addParagraph(content: string, inline?: IRInlineNode[], source?: IRSource): this {
    this.slide.children.push({
      id: generateId(),
      type: 'paragraph',
      content,
      inline,
      source,
    });
    return this;
  }

  addList(ordered: boolean, items: { content: string; inline?: IRInlineNode[]; children?: IRBlockNode[] }[], source?: IRSource): this {
    this.slide.children.push({
      id: generateId(),
      type: 'list',
      ordered,
      items,
      source,
    });
    return this;
  }

  addImage(src: string, alt?: string, source?: IRSource): this {
    this.slide.children.push({
      id: generateId(),
      type: 'image',
      src,
      alt,
      source,
    });
    return this;
  }

  done(): IRBuilder {
    return this.parent;
  }

  build(): IRDocument {
    return this.parent.build();
  }
}
