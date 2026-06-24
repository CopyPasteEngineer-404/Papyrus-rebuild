declare module 'epub-gen' {
  interface EPubOptions {
    title: string;
    author: string;
    publisher?: string;
    date?: string;
    css?: string;
    fonts?: string[];
    customFiles?: string[];
    verbose?: boolean;
  }

  interface ChapterOptions {
    excludeFromToc?: boolean;
    before?: string;
    after?: string;
  }

  class EPub {
    constructor(options: EPubOptions, output: string);
    addSection(title: string, data: string, options?: ChapterOptions): void;
    makeEpoch(): void;
    on(event: 'end', callback: () => void): void;
    on(event: 'error', callback: (err: Error) => void): void;
  }

  export default EPub;
}
