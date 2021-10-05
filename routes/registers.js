const sqlString = require('sqlstring')

function formatCount(resp) {
  // return Object.assign({}, resp.map((x) => ({
  //   "name" : x["property_value"],
  //   "value": x["count(property_value)"]
  // })))
  count_dict = []
  return resp.map( element => (({
    "name": element["property_value"],
    "value": element["count"]
  })))

}

function formatClauses(req) {
  const timeClause = req.get("hours") > 0 ? sqlString.format('and Snapshots.logtime >= ( current_date - interval \'? hours\' ) ', parseInt(req.get("hours"))) : ''
  const storeClause = req.get("store") > 0 ? sqlString.format('and Snapshots.store = ? ', req.get("store")) : ''
  return {timeClause, storeClause}
}

module.exports = function (app, connection, log) {

  app.get('/registers/:storenum-:regnum', (req, res) => {
    connection.query(sqlString.format('SELECT * FROM Registers ' +
      'INNER JOIN Properties ON Registers.property_id = Properties.property_id ' +
      'WHERE store = ? and register = ? ' +
      'ORDER BY logtime DESC',
      [req.params["storenum"], req.params["regnum"]]),
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          log.info(`GET ${req.originalUrl}`)
          res.send(resp)
        }
      })
  })

  app.get('/registers/reloads/', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)


    connection.query(sqlString.format('SELECT COUNT(*)' +
      'FROM Registers ' +
      'WHERE Registers.property_id = \'12\' ' +
      storeClause +
      timeClause +
      'and Registers.logtime >= ( current_date - interval \'? days\' )',
      [req.params["lastdays"]]),
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          log.info(`GET ${req.originalUrl}`)
          res.send({
            "count": resp[0]["COUNT(*)"]
          })
        }
      })
  })

  app.get('/registers/pinpad', (req, res) => {
    connection.query('SELECT property_value, count(property_value) ' +
      'FROM Registers INNER JOIN Properties ' +
      'ON Registers.property_id = Properties.property_id ' +
      'WHERE Registers.property_id = 9 GROUP BY Registers.property_value',
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          log.info(`GET ${req.originalUrl}`)
          res.send(formatCount(resp))
        }
      })
  })

  app.get('/registers/uiState', (req, res) => {
    connection.query('SELECT property_value, count(property_value) ' +
      'FROM Registers INNER JOIN Properties ' +
      'ON Registers.property_id = Properties.property_id ' +
      'WHERE Registers.property_id = 1 GROUP BY Registers.property_value',
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(JSON.stringify(err))
        } else {
          log.info(`GET ${req.originalUrl}`)
          res.send(formatCount(resp))
        }
      })
  })

  app.get('/registers/scanner:num', (req, res) => {
    const property_id = req.params["num"] === 1 ? 2 : 3
    connection.query(sqlString.format('SELECT property_value, count(property_value) FROM Registers ' +
      'INNER JOIN Properties ON Registers.property_id = Properties.property_id ' +
      'WHERE Registers.property_id = ? ' +
      'GROUP BY property_value ', property_id),
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(JSON.stringify(err))
        } else {
          log.info(`GET ${req.originalUrl}`)
		  log.info(formatCount(resp['rows']))
          res.send(formatCount(resp['rows']))
        }
      })
  })

}