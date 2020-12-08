const sqlString = require('sqlstring')
const lodashDeepClone = require("lodash.clonedeep")

function formatCount(resp) {
  count_dict = []
  return resp.map(element => (({
    "name": element["property_value"],
    "value": element["count(property_value)"]
  })))
}

async function getProperties(connection, log) {
  let properties
  return connection.promise().query("Select * from Properties WHERE property_id >= 0 ")
    .then((response) => {
      return response[0]
    }).catch((err) => {
      return null
    })
}

function formatReloads(response, log, connection, res) {
  connection.promise().query("Select * from Properties WHERE property_id >= 0 ")
    .then((props) => {

      var result = props[0].reduce(function(obj, x) {
        obj[x["property_id"]] = "";
        return obj;
      }, {});

      let copyablePropObject = {
        "country": null,
        "register": null,
        "store": null,
        "props": {
          ...result
        }
      }
      connection.promise().query("SELECT * FROM Snapshots ORDER BY snaptime DESC")
        .then((snapshots) =>  {
          let collection = {}
          snapshots[0].forEach(snapshot => {
            if (!(snapshot["snaptime"] in collection)) {
              collection[snapshot["snaptime"]] = lodashDeepClone(copyablePropObject)
              collection[snapshot["snaptime"]]["country"] = snapshot["country_id"]
              collection[snapshot["snaptime"]]["register"] = snapshot["register"]
              collection[snapshot["snaptime"]]["store"] = snapshot["store"]
            } else {
              collection[snapshot["snaptime"]]["props"][snapshot["property_id"]] = snapshot["property_value"]
            }
          })
          res.send(collection)
        })
    })

}

function logSuccess(req, res, log) {
  log.info(`GET ${req.originalUrl}`)
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

  app.get('/snapshots/reloads/', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)
    const query = 'SELECT COUNT(DISTINCT snaptime) ' +
      'FROM Snapshots ' +
      'WHERE Snapshots.logtime <= ( CURDATE() ) ' +
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
            "count": resp[0]["COUNT(DISTINCT snaptime)"]
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

  app.get('/snapshots/properties', (req, res) => {
    const {storeClause, timeClause} = formatClauses(req)
    const query = sqlString.format('SELECT * from Properties ' +
      'WHERE property_id >= 0 ' + storeClause + timeClause);
    log.debug(query)

    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send({"status": "error"})
        } else {
          logSuccess(req, res, log)
          res.send(resp)
        }
      })
  })

  app.get('/snapshots/snaptime', (req, res) => {
    connection.query('SELECT * FROM Snapshots limit 5',
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send({"status": "error"})
        } else {
          logSuccess(req, res, log)
          formatReloads(resp, log, connection, res)
        }
      })
  })

  app.get("/snapshots/testProps", (req, res) => {
    getProperties(connection, log)
      .then((properties) => res.send(properties))
  })

}