import { chmodSync, rmSync } from 'node:fs'
import { build } from 'esbuild'

rmSync('dist', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [
    '@ffmpeg-installer/ffmpeg',
    '@napi-rs/canvas',
    '@umessen/dicom-deidentifier',
    '@zip.js/zip.js',
    'dcmjs',
    'effect',
    'jszip',
    'node-unrar-js',
    'pdfjs-dist',
    'sharp',
    'undici',
  ],
})

chmodSync('dist/index.js', 0o755)
