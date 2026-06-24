import { IRDocument, IRNode, IR_VERSION } from '../../shared/types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateIR(doc: IRDocument): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (doc.type !== 'document') {
    errors.push('Root node must be of type "document"');
  }

  if (doc.version !== IR_VERSION) {
    warnings.push(`IR version mismatch: expected ${IR_VERSION}, got ${doc.version}`);
  }

  if (!doc.title || doc.title.trim() === '') {
    warnings.push('Document has no title');
  }

  if (!Array.isArray(doc.children)) {
    errors.push('Document must have a children array');
    return { valid: false, errors, warnings };
  }

  const ids = new Set<string>();

  for (const child of doc.children) {
    validateNode(child, errors, warnings, ids);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateNode(node: IRNode, errors: string[], warnings: string[], ids: Set<string>): void {
  if (!node.id) {
    errors.push(`Node of type "${node.type}" is missing an id`);
  } else if (ids.has(node.id)) {
    errors.push(`Duplicate node id: "${node.id}"`);
  } else {
    ids.add(node.id);
  }

  if (!node.type) {
    errors.push('Node is missing a type');
    return;
  }

  switch (node.type) {
    case 'section': {
      const section = node as any;
      if (!section.title || section.title.trim() === '') {
        warnings.push('Section has no title');
      }
      if (typeof section.level !== 'number' || section.level < 1) {
        errors.push(`Section level must be >= 1, got ${section.level}`);
      }
      if (Array.isArray(section.children)) {
        for (const child of section.children) {
          validateNode(child, errors, warnings, ids);
        }
      }
      break;
    }

    case 'paragraph': {
      const para = node as any;
      if (typeof para.content !== 'string') {
        errors.push('Paragraph must have a string content');
      }
      break;
    }

    case 'list': {
      const list = node as any;
      if (!Array.isArray(list.items)) {
        errors.push('List must have an items array');
      }
      break;
    }

    case 'table': {
      const table = node as any;
      if (!Array.isArray(table.headers)) {
        errors.push('Table must have a headers array');
      }
      if (!Array.isArray(table.rows)) {
        errors.push('Table must have a rows array');
      }
      break;
    }

    case 'code': {
      const code = node as any;
      if (typeof code.content !== 'string') {
        errors.push('Code block must have a string content');
      }
      break;
    }

    case 'diagram': {
      const diag = node as any;
      if (typeof diag.content !== 'string') {
        errors.push('Diagram must have a string content');
      }
      break;
    }

    case 'slide': {
      const slide = node as any;
      if (!slide.title || slide.title.trim() === '') {
        warnings.push('Slide has no title');
      }
      if (Array.isArray(slide.children)) {
        for (const child of slide.children) {
          validateNode(child, errors, warnings, ids);
        }
      }
      break;
    }
  }
}
