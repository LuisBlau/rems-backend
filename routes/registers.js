const sqlString = require('sqlstring')
const atob = require("atob")
const btoa = require("btoa")
const fs = require('fs');
const readline = require('readline');
var bodyParser = require('body-parser');
const mongodb = require("mongodb")

const { ServiceBusClient } = require("@azure/service-bus");
const { Console } = require('console');
const sbClient = new ServiceBusClient("Endpoint=sb://remscomm.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=Dk+TDFecPYBkRKtCqqudv1dnrN2hR5bcEN1t1alztOI=");
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
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
  app.post('/sendSNMPRequest', bodyParser.json(), (req, res) => {
    console.log("New SNMP Request set");
    console.log(JSON.stringify(req.body))
	const sender = sbClient.createSender(req.cookies["retailerId"].toLowerCase());
	res.send(sender.sendMessages({"body": req.body}));
    let snmpDatabase = azureClient.db("pas_software_distribution").collection("config-files");
    snmpDatabase.insertOne(req.body, function (err, res) {
    if (err) {
        const msg = { "error": err }
        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
        throw err;
    }
  });
  })
  
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
		y["Download"] = x["location"]["URL"]
		y["Version"] = x["values"]["Version"]
		y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g",""))))
		y["ExtractType"] = x["values"]["ExtractType"]
		y["State"] = x["values"]["State"]
		modifiedResults.push(y)
	}
	res.send(modifiedResults)
  });
  });

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
		y["Download"] = x["location"]["URL"]
		y["Version"] = x["values"]["Version"]
		y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g",""))))
		y["ExtractType"] = x["values"]["ExtractType"]
		y["State"] = x["values"]["State"]
		modifiedResults.push(y)
	}
	res.send(modifiedResults)
  });
  });
app.get('/registers/dumps', (req, res) => {
   var results = []
   var snapshots = azureClient.db("pas_reloads").collection("dumps");
   snapshots.find({"Retailer":req.cookies["retailerId"]}).toArray(function(err, result){
     results = result;
     console.log(result)
	let modifiedResults = []
	for (var x of results) {
		var y = x
    
    y["Download"] = x["location"]["URL"]
		y["Version"] = x["values"]["Version"]
    y["Reason"] = x["values"]["Reason"]
		if(x["RegNum"]) {
			y["System"] = x["RegNum"]
		} else {
			y["System"] = x["values"]["Controller ID"]
		}
		y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g",""))))
		y["ExtractType"] = x["values"]["ExtractType"]
		y["State"] = x["values"]["State"]
		y["Rids"] = x["values"]["rids"]
    
    modifiedResults.push(y)
	}
	res.send(modifiedResults)
  });
  });


  app.get('/registers/extracts/:string', (req, res) => {
	  j = JSON.parse(atob(req.params["string"]))
	  msgSent = {"body": {
		  "retailer":j.Retailer,
		  "store":j.Store, 
		  "filename":j.values.File
		}
	  };
	  console.log("Sending: "+msgSent);
    const sender = sbClient.createSender(req.cookies["retailerId"].toLowerCase());
	res.send(sender.sendMessages(msgSent));
  })
  

  app.post("/registers/requestDump/",bodyParser.json(),  (req,res) => {
    console.log("requestDump")
  
	  console.log(req.body)
    console.log(JSON.stringify(req.body))
    //console.log(req)
	  msgSent = {"body": {
		  "retailer":req.body["retailer_id"],
		  "store":req.body["store_name"], 
		  "agent":req.body["agent"],
		  "dataCapture":req.body["dataCapture"]
		}
	  };
	  console.log("Sending: "+msgSent);
    const sender = sbClient.createSender(req.cookies["retailerId"].toLowerCase());
	res.send(sender.sendMessages(msgSent));
  })

app.get('/registers/captures', (req, res) => {
  var results = []
  var snapshots = azureClient.db("pas_reloads").collection("captures");

  snapshots.find({"Retailer":req.cookies["retailerId"]}).toArray(function(err, result){
    results = result;
    console.log(result)
 let modifiedResults = []
 for (var x of results) {
   var y = x
   
   y["Download"] = x["location"]["URL"]
   y["SBreqLink"] = "/api/registers/captures/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g",""))))
   y["CaptureType"] = x["values"]["CaptureType"]
   y["Agent"] = x["values"]["Agent"]
   y["CaptureSource"] = x["values"]["CaptureSource"]
   
   modifiedResults.push(y)
 }
 res.send(modifiedResults)
 });
});


app.get('/registers/captures/:string', (req, res) => {
  j = JSON.parse(atob(req.params["string"]))
  msgSent = {"body": {
    "retailer":j.Retailer,
    "store":j.Store, 
    "filename":j.values.File
  }
  };
  console.log("Sending: "+JSON.stringify(msgSent));
  const sender = sbClient.createSender(req.cookies["retailerId"].toLowerCase());
res.send(sender.sendMessages(msgSent));
});

app.get('/registers/commands/:string', (req, res) => {
  j = JSON.parse(atob(req.params["string"]))
  msgSent = {"body": {
    "retailer":j.Retailer,
    "store":j.Store, 
    "agent":j.Agent,
    "command":j.Command
  }
  };
  console.log("Sending: "+JSON.stringify(msgSent));
  const sender = sbClient.createSender(req.cookies["retailerId"].toLowerCase());
res.send(sender.sendMessages(msgSent));
});


}

