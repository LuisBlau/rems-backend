// Security
const cors = require('cors')
const https = require('https')
const fs = require('fs')
const helmet = require('helmet')
// Logging
const log = require('loglevel')
const prefix = require('loglevel-format')
global.secret = 'replace with your secret'
log.setDefaultLevel('trace')
prefix.apply(log, {
  template: '[%t][%l] - %m',
  messageFormatter: function (data) {
    return data
  },
  timestampFormatter: function (date) {
    return date.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1')
  },
  levelFormatter: function (level) {
    return level.toUpperCase()
  },
  nameFormatter: function (name) {
    return name || 'root'
  }
})

// Express
const express = require('express')
const app = express()
let port = 443
let httpPort = 80
app.use(helmet())
app.use(cors())
var cookieParser = require('cookie-parser')
app.use(cookieParser())
// app.use(jwtAuth()) turning off the auth cookie
const { DB, HOST, PASSWORD, USER } = require('./db.config')

const { Pool } = require('pg')
const connection = new Pool({
  user: 'logstash',
  host: '10.89.196.162',
  database: 'wpstatus',
  password: 'skywalker',
  port: 5432
})

require('./routes')(app, connection, log)

const httpsOptions = {
  key: fs.readFileSync('./default.key'),
  cert: fs.readFileSync('./default.crt')
}

// for development
if ( process.env.RMA_DEV == "true" && process.env.NODE_ENV !== 'test') {
    console.log("It's a dev box")
    port=3002
    httpPort=3001
}

app.listen(httpPort, () => console.log(`http app listening at port ${httpPort}`))
// https.createServer(app).listen(port, () => {console.log("server is running at port "+port) })
https.createServer(httpsOptions, app).listen(port)
console.log(`https app listening at port ${port}`)
