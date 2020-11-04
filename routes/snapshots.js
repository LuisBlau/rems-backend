const sqlString = require('sqlstring')

function formatCount(resp) {
  count_dict = []
  return resp.map(element => (({
    "name": element["property_value"],
    "value": element["count(property_value)"]
  })))
}

function logSuccess(req, res, log) {
  log.info(`GET ${req.originalUrl}`)
}

function hasInfo(header) {
  if (header === 'null' ||
    header === null ||
    header === '') {
    return false
  } else return true
}

function formatClauses(req) {
  const timeClause = parseInt(req.get("hours")) > 0 ? sqlString.format('and Snapshots.logtime >= ( CURDATE() - INTERVAL ? HOUR ) ', req.get("hours")) : ''
  const storeClause = parseInt(req.get("store")) > 0 ? sqlString.format('and Snapshots.store = ? ', req.get("store")) : ''
  return {timeClause, storeClause}
}

module.exports = function (app, connection, log) {

  app.get('/snapshots/:storenum-:regnum', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)

    connection.query(sqlString.format('SELECT * FROM Snapshots ' +
      'INNER JOIN Properties ON Snapshots.property_id = Properties.property_id ' +
      'WHERE store = ? and register = ? ' +
      timeClause +
      'ORDER BY logtime DESC',
      [req.params["storenum"], req.params["regnum"]]),
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          logSuccess(req, res, log)
          res.send(resp)
        }
      })
  })

// TODO replace 'Snapshots" with "Snapshots" whenever they start working again
  app.get('/snapshots/reloads/', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)
    const query = 'SELECT COUNT(*) ' +
      'FROM Snapshots ' +
      'WHERE Snapshots.property_id = \'12\' ' +
      storeClause +
      timeClause
    log.debug(query)
    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          logSuccess(req, res, log)
          res.send({
            "count": resp[0]["COUNT(*)"]
          })
        }
      })
  })

  app.get('/snapshots/pinpad', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)

    const query = 'SELECT property_value, count(property_value) ' +
      'FROM Snapshots INNER JOIN Properties ' +
      'ON Snapshots.property_id = Properties.property_id ' +
      'WHERE Snapshots.property_id = 9 ' + storeClause + timeClause +
      'GROUP BY Snapshots.property_value'

    log.debug(query)


    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          logSuccess(req, res, log)
          res.send(formatCount(resp))
        }
      })
  })

  app.get('/snapshots/uiState', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)

    const query = 'SELECT property_value, count(property_value) ' +
      'FROM Snapshots INNER JOIN Properties ' +
      'ON Snapshots.property_id = Properties.property_id ' +
      'WHERE Snapshots.property_id = 1 ' + storeClause + timeClause +
      'GROUP BY Snapshots.property_value'

    log.debug(query)

    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(JSON.stringify(err))
        } else {
          logSuccess(req, res, log)
          res.send(formatCount(resp))
        }
      })
  })

  app.get('/snapshots/scanner:num', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)
    const property_id = req.params["num"] === 1 ? 2 : 3
    const query = sqlString.format('SELECT property_value, count(property_value) FROM Snapshots ' +
      'INNER JOIN Properties ON Snapshots.property_id = Properties.property_id ' +
      'WHERE Snapshots.property_id = ? ' + storeClause + timeClause +
      'GROUP BY property_value ', property_id);
    log.debug(query)

    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(JSON.stringify(err))
        } else {
          logSuccess(req, res, log)
          res.send(formatCount(resp))
        }
      })
  })


}