// Bundles the API (and the shared package) into dist/ for `node dist/main.js`.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
};

await build({
  ...common,
  entryPoints: { main: 'src/main.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  plugins: [
    {
      name: 'bundle-shared',
      setup(b) {
        b.onResolve({ filter: /^@rmm\/shared$/ }, () => ({ path: new URL('../../../packages/shared/src/index.ts', import.meta.url).pathname }));
      },
    },
  ],
});
console.log('api built to dist/');
