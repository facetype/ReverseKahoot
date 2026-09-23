import { fileURLToPath, URL } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, type Plugin } from 'vite'

// Dev-only: static hosts redirect /login to /login/ for directory index files;
// Vite's dev server does not, so mirror that behaviour here.
function trailingSlashRedirect(paths: string[]): Plugin {
  return {
    name: 'trailing-slash-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query] = (req.url ?? '').split('?')
        if (paths.includes(pathname)) {
          res.statusCode = 301
          res.setHeader('Location', `${pathname}/${query ? `?${query}` : ''}`)
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    trailingSlashRedirect(['/login']),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        login: fileURLToPath(new URL('./login/index.html', import.meta.url)),
      },
    },
  },
})
