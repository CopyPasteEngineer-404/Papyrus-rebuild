export { IRBuilder, SectionBuilder, SlideBuilder } from './builder';
export { validateIR, type ValidationResult } from './validate';
export { serializeIR } from './serialize';
export { walkIR, findNodesByType, countNodesByType, extractHeadings, flattenChildren, type Visitor } from './traversal';
