import express from 'express'
import cors from 'cors'
import { createDivineApiRouter, logApiStatus } from './server/divineApi.js'

const PORT = Number(process.env.PORT) || 3001

const app = express()
app.use(cors())
app.use('/api', createDivineApiRouter())

app.listen(PORT, () => {
  console.log(`[Prompt Genesis] API proxy listening on http://localhost:${PORT}`)
  logApiStatus()
})
