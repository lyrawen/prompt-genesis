import type { Plugin } from 'vite'
import express from 'express'
import { createDivineApiRouter, logApiStatus } from './server/divineApi.js'

/** Mount /api routes inside Vite dev server — no separate process needed. */
export function divineApiPlugin(): Plugin {
  return {
    name: 'divine-api',
    configureServer(server) {
      const apiApp = express()
      apiApp.use(createDivineApiRouter())
      server.middlewares.use('/api', apiApp)
      logApiStatus()
      console.log('[Prompt Genesis] API mounted at http://localhost:<vite>/api')
    },
  }
}
