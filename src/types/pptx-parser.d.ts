declare module 'pptx-parser' {
  interface Slide {
    title?: string;
    text?: string;
    notes?: string;
    images?: Array<{
      src: string;
      alt?: string;
    }>;
  }

  class PptxParser {
    parse(buffer: Buffer): Slide[];
  }

  export default PptxParser;
  export { Slide, PptxParser };
}
