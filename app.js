// Security
const cors = require('cors')
const helmet = require('helmet')

// Logging
const log = require('loglevel')
const prefix = require('loglevel-format')
log.setDefaultLevel("trace")
prefix.apply(log, {
  template: '[%t][%l] - %m',
  messageFormatter: function (data) {
    return data;
  },
  timestampFormatter: function (date) {
    return date.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');
  },
  levelFormatter: function (level) {
    return level.toUpperCase();
  },
  nameFormatter: function (name) {
    return name || 'root';
  }
});

// Express
const express = require('express')
const app = express()
const port = 3001
app.use(helmet())
app.use(cors())

const mysql = require('mysql2')
let {DB, HOST, PASSWORD, USER} = require('./db.config')

const connection = mysql.createPool({
  host: HOST,
  user: USER,
  password: PASSWORD,
  database: DB,
  waitForConnections: true
})

require('./routes')(app, connection, log);


app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))