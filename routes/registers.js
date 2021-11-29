const sqlString = require('sqlstring')
const atob = require("atob")
const btoa = require("btoa")

const { ServiceBusClient } = require("@azure/service-bus");
const sbClient = new ServiceBusClient("Endpoint=sb://remscomm.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=Dk+TDFecPYBkRKtCqqudv1dnrN2hR5bcEN1t1alztOI=");
var azureClient = new require("mongodb").MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

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
  app.get('/registers/extracts', (req, res) => {
/* 	var results = [{ 
   "Retailer": "T0BGBBL",
   "RegNum": "44",
   "Store": "US0303",
   "Timestamp": "2021/11/11 16:00:00",
   "values": {
     "File":"SCS_Extract_Lane_S303_L044_RMA Default Policy_20211028_164049_CST.zip",
      "InstalledPath":"/cdrive/ext/signed/chec/IBMSelfCheckout",
      "ExtractType":"Extract",
	  "State":"Ohio"
   },
   "location": {
      "Store":"true",
      "Azure":"false",
      "AzureUrl":""
   }
},
{ 
   "Retailer": "T0BGBBL",
   "RegNum": "45",
   "Store": "US0303",
   "Timestamp": "2021/11/11 16:00:00",
   "values": {
     "File":"SCS_Extract_Lane_S303_L044_RMA Default Policy_20211028_164049_CST.zip",
      "InstalledPath":"/cdrive/ext/signed/chec/IBMSelfCheckout",
      "ExtractType":"Extract",
	  "State":"Ohio"
   },
   "location": {
      "Store":"true",
      "Azure":"false",
      "AzureUrl":""
   }
}
] */
   var results = []
   var snapshots = azureClient.db("pas_reloads").collection("extracts");
   snapshots.find().toArray(function(err, result){
     results = result;
     console.log(result)
	let modifiedResults = []
	for (var x of results) {
		var y = x
	    y["InStore"] = x["location"]["Store"]
		y["SBreqLink"] = "http://127.0.0.1:3001/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g",""))))
		y["ExtractType"] = x["values"]["ExtractType"]
		y["State"] = x["values"]["State"]
		modifiedResults.push(y)
	}
	res.send(modifiedResults)
  });
  });
  

  app.get('/registers/extracts/:string', (req, res) => {
	  j = JSON.parse(atob(req.params["string"]))
	  msgSent = {
		  "retailer":j.retailer,
		  "store":j.store, 
		  "filename":j.values.file
	  };
    const sender = sbClient.createSender("storefilerequestsubscription");
    sender.sendMessages(msgSent);
  })
}