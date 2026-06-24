export default {
  app: {
    name: 'Papyrus',
    identifier: 'com.papyrus.desktop',
    version: '2.0.0',
  },
  build: {
    bun: {
      entrypoint: 'src/desktop/bun/index.ts',
    },
    views: {
      'main-ui': {
        entrypoint: 'src/desktop/renderer/index.tsx',
      },
    },
    copy: {
      'index.html': 'views/main-ui/index.html',
    },
  },
  release: {
    baseUrl: 'https://releases.papyrus.app/',
  },
};
