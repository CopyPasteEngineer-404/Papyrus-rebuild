declare module 'rtf-parser' {
  interface RTFSpan {
    value?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    font?: string;
    size?: number;
    color?: string;
  }

  interface RTFParagraph {
    content: RTFSpan[];
  }

  interface RTFInfo {
    title?: string;
    author?: string;
    created?: string;
  }

  interface RTFDocument {
    info?: RTFInfo;
    content: RTFParagraph[];
  }

  interface ReadableStream {
    on(event: 'data', callback: (doc: RTFDocument) => void): void;
    on(event: 'end', callback: () => void): void;
    on(event: 'error', callback: (err: Error) => void): void;
  }

  const rtfParser: {
    parse(content: string): ReadableStream;
  };

  export default rtfParser;
  export { RTFSpan, RTFParagraph, RTFInfo, RTFDocument, ReadableStream };
}
