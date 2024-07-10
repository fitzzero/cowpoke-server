import express, { Express } from 'express'
import * as http from 'http'
import { Server } from 'socket.io'
import bodyParser from 'body-parser'
import { logAlert, logSuccess } from './lib/logger'
import { ioEvents } from './io/ioEvents'
export const ioServer: Server = new Server()

export const startExpress = async () => {
  try {
    const isProd = process.env.NODE_ENV == 'production'
    if (!isProd) {
      require('dotenv').config({ path: '.env.local' })
    }
    const port = isProd ? 8080 : 3001
    const app: Express = express()
    app.use(bodyParser.json())

    const server: http.Server = http.createServer(app)
    ioServer.attach(server)

    // Events
    ioEvents()
    server.listen(port, () => {
      logSuccess(`Ready on port ${port} (${process.env.NODE_ENV})`, 'Express')
    })
  } catch (e: any) {
    logAlert(e, 'express')
  }
}
