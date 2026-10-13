import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    // relative asset paths: the same build runs at the server root and under /<repo>/ on GitHub Pages
    base: './',
    build: {
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'src/client/index.html')
            }
        }
    },
    root: 'src/client',
});