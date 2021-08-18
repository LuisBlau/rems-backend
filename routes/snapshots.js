
const sqlString = require('sqlstring')
const lodashDeepClone = require("lodash.clonedeep")

function formatCount(resp) {
  count_dict = []
  return resp.rows.map(element => (({
    "name": element["property_value"],
    "value": element["count"]
  })))
}

async function getProperties(connection, log) {
  let properties
  return connection.query("Select * from Properties WHERE property_id >= 0 ")
    .then((response) => {
      return response.rows
    }).catch((err) => {
      return null
    })
}

function formatReloads(req, log, connection, res) {
  connection.query("Select * from properties WHERE property_id >= 0 ")
    .then((props) => {
      
      if (props === undefined)
        return null;
      
      var result = props.rows.reduce(function(obj, x) {
        obj[x["property_id"]] = "";
        return obj;
      }, {});

      let copyablePropObject = {
        "country": null,
        "register": null,
        "store": null,
        "datetime": null,
        "props": {
          ...result
        }
      }
      let {storeClause, timeClause} = formatClauses(req)
      log.info(req.get("hours"))
      connection.query("SELECT * FROM Snapshots " +
        "WHERE property_id >= 0  " +
        storeClause + timeClause +
        "ORDER BY snaptime DESC")
        .then((snapshots) =>  {
          let collection = {}
          let final = []
          snapshots.rows.forEach(snapshot => {
            if (!(snapshot["snaptime"] in collection)) {
              collection[snapshot["snaptime"]] = lodashDeepClone(copyablePropObject)
              collection[snapshot["snaptime"]]["country"] = snapshot["country_id"]
              collection[snapshot["snaptime"]]["register"] = snapshot["register"]
              collection[snapshot["snaptime"]]["store"] = snapshot["store"]
              collection[snapshot["snaptime"]]["datetime"] = snapshot["snaptime"]
            } else {
              collection[snapshot["snaptime"]]["props"][snapshot["property_id"]] = snapshot["property_value"]
            }
          })
          Object.keys(collection).forEach((snaptime) => {
            final.push(collection[snaptime])
          })
          res.send(final)
        })
    })
}

function logSuccess(req, res, log) {
  log.info(`GET ${req.originalUrl}`)
}

function formatClauses(req) {
  const timeClause = parseInt(req.get("hours")) > 0 ? sqlString.format('and Snapshots.snaptime >= ( current_date - interval \'? hours\' ) ', parseInt(req.get("hours"))) : ''
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
      'WHERE Snapshots.logtime <= ( current_date ) ' +
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
            "count": resp.rows["COUNT(DISTINCT snaptime)"]
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
          res.send(resp.rows.sort((a,b) => (a.property_id > b.property_id) ? 1: -1))
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
          formatReloads(req, log, connection, res)
        }
      })
  })

  app.get("/snapshots/testProps", (req, res) => {
    getProperties(connection, log)
      .then((properties) => res.send(properties))
  })

}