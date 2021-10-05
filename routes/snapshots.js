
const sqlString = require('sqlstring')
const lodashDeepClone = require("lodash.clonedeep")

function formatCount(resp) {
  count_dict = []
  return resp.rows.map(element => (({
    "name": element["property_value"],
    "value": element["count"]
  })))
}

function formatVersion(resp) {
    versions = []
    resp.rows.forEach(function(rows) {
      versions.push(rows.property_value)
      });
    return versions
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
      let {storeClause, timeClause, countryClause} = formatClauses(req)
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
  const countryClause = req.get("country") == "ca" ? sqlString.format('and Snapshots.country_id = 3 ') : (req.get("country")  == "us" ? sqlString.format('and Snapshots.country_id in (0,97) ') : '')
  const versionClause = (req.get("version")) ? sqlString.format('INNER JOIN public.snapshots snap ON snap.country_id=this.country_id '+
          'AND snap.store=this.store AND snap.snaptime=this.snaptime WHERE snap.property_id=\'33\' AND snap.property_value LIKE ? ', req.get("version") ) : ''
  return {timeClause, storeClause, countryClause, versionClause}
}

module.exports = function (app, connection, log) {

  app.get('/snapshots/:storenum-:regnum', (req, res) => {
    const {storeClause, timeClause, countryClause, versionClause} = formatClauses(req)

    connection.query(sqlString.format('SELECT * FROM Snapshots ' +
      'INNER JOIN Properties ON Snapshots.property_id = Properties.property_id ' +
      'WHERE store = ? and register = ? ' +
      timeClause + countryClause +
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
    const {storeClause, timeClause, countryClause} = formatClauses(req)
    const query = 'SELECT COUNT(DISTINCT snaptime) ' +
      'FROM Snapshots ' +
      'WHERE Snapshots.logtime <= ( current_date ) ' +
      storeClause +
      timeClause + countryClause
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
  
  app.get('/snapshots/reloadstats/', (req, res) => {
    const {storeClause, timeClause, countryClause} = formatClauses(req)
    const query = ' SELECT extract(hour from snaptime), COUNT(extract(hour from snaptime))' +
      'FROM Snapshots ' +
      'WHERE Snapshots.snaptime <= ( current_date ) ' +
      storeClause +
      timeClause + countryClause + "GROUP BY extract(hour from snaptime)"
    log.debug(query)
    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          for (x of resp["rows"])
            x["count"] = parseInt(x["count"])
          logSuccess(req, res, log)
          res.send(resp["rows"])
        }
      })
  })

  app.get('/snapshots/versions', (req, res) => {
    const query = 'SELECT snap.property_value ' +
      'FROM public.registers snap WHERE snap.property_id=33 ' +
      'AND logtime > current_date - interval \'14 days\' ' +
      'AND country_id not in (98, 99) ' +
      'GROUP by property_value ORDER BY property_value desc'

    log.debug(query)

    connection.query(query,
      (err, resp, fields) => {
        if (err) {
          log.error(err)
          res.send(err)
        } else {
          logSuccess(req, res, log)
          res.send(formatVersion(resp))
        }
      })
  })
    
  app.get('/snapshots/pinpad', (req, res) => {
    const {storeClause, timeClause, countryClause, versionClause} = formatClauses(req)
    const query = 'SELECT this.property_value, count(this.property_value) ' +
      'FROM (SELECT snapshots.snaptime, snapshots.country_id, snapshots.store, ' +
      'snapshots.property_value FROM public.snapshots ' +
      'WHERE property_id=9 ' + storeClause + timeClause + countryClause +
      ') AS this ' + versionClause +
      'GROUP BY 1 ORDER BY 1 DESC'
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
    const {storeClause, timeClause, countryClause, versionClause} = formatClauses(req)
    const query = 'SELECT this.property_value, count(this.property_value) ' +
      'FROM (SELECT snapshots.snaptime, snapshots.country_id, snapshots.store, ' +
      'snapshots.property_value FROM public.snapshots WHERE property_id = 1 ' +
      storeClause + timeClause + countryClause + ') AS this ' + versionClause +
      'GROUP BY 1 ORDER BY 1 DESC'
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

  app.get('/snapshots/itemSubstate', (req, res) => {
    const {storeClause, timeClause, countryClause, versionClause} = formatClauses(req)
    const query = 'SELECT this.property_value, count(this.property_value) ' +
      'FROM (SELECT snapshots.snaptime, snapshots.country_id, snapshots.store, ' +
      'snapshots.property_value FROM public.snapshots INNER JOIN public.snapshots snap2 ' +
      'ON snap2.snaptime = snapshots.snaptime AND snap2.property_id = 1 AND snap2.property_value = \'item\' ' +
      'WHERE snapshots.property_id = 24 ' + storeClause + timeClause + countryClause +
      ') AS this ' + versionClause + 
      'GROUP BY 1 ORDER BY 1 DESC'
    
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

  app.get('/snapshots/tenderSubstate', (req, res) => {
    const {storeClause, timeClause, countryClause, versionClause} = formatClauses(req)
    const query = 'SELECT this.property_value, count(this.property_value) ' +
      'FROM (SELECT snapshots.snaptime, snapshots.country_id, snapshots.store, ' +
      'snapshots.property_value FROM public.snapshots INNER JOIN public.snapshots snap2 ' +
      'ON snap2.snaptime = snapshots.snaptime AND snap2.property_id = 1 AND snap2.property_value = \'tender\' ' +
      'WHERE snapshots.property_id = 24 ' + storeClause + timeClause + countryClause +
      ') AS this ' + versionClause + 
      'GROUP BY 1 ORDER BY 1 DESC'
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
    const {storeClause, timeClause, countryClause} = formatClauses(req)
    const query = sqlString.format('SELECT * from Properties ' +
      'WHERE property_id >= 0 ' + storeClause + timeClause + countryClause);
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
