// Std Library
const {readFileSync} = require('fs')
const path = require('path')

function sendRelevantJSON(res, jsonPath) {
  res.send(JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'Data', jsonPath)
    )
  ))
}

module.exports = function (app, connection, log) {


  app.get('/REMS/store-connection', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'store_connection.json');

  })

  app.get('/REMS/vpd', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'out_vpd_filtered.json');
  })

  app.get('/REMS/release', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'out_release.json');
  })

  app.get('/REMS/low-mem', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'low_mem.json');
  })

}