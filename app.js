// Security
const cors = require('cors')
const helmet = require('helmet')
const jwtAuth = require("./middleware/jwtauth")
console.log(cookieParser)
// Logging
const log = require('loglevel')
const prefix = require('loglevel-format')
global.secret = "replace with your secret";
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
var cookieParser = require('cookie-parser')
app.use(cookieParser())
app.use(jwtAuth())
const mysql = require('mysql2')
let {DB, HOST, PASSWORD, USER} = require('./db.config')

const { Pool } = require('pg')
const connection = new Pool({
  user: 'logstash',
  host: '10.89.196.162',
  database: 'wpstatus',
  password: 'skywalker',
  port: 5432,
})

require('./routes')(app, connection, log);


app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`))