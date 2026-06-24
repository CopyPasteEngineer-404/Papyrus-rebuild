declare module 'epub2' {
  interface EpubChapter {
    id: string;
    href: string;
    title: string;
  }

  interface EpubMetadata {
    title?: string;
    creator?: string;
    language?: string;
    publisher?: string;
    date?: string;
  }

  interface EpubInstance {
    metadata: EpubMetadata;
    flow: EpubChapter[];
    getFile(id: string, callback: (err: Error | null, data: Buffer) => void): void;
  }

  function open(filePath: string, callback: (err: Error | null, data: EpubInstance) => void): void;

  export default { open };
  export { EpubChapter, EpubMetadata, EpubInstance, open };
}
