const sqlString = require('sqlstring')
const atob = require("atob")
const btoa = require("btoa")
var bodyParser = require('body-parser');
const mongodb = require("mongodb")
const { ServiceBusClient } = require("@azure/service-bus");
const { InsertAuditEntry } = require('../middleware/auditLogger');

const sbClient = new ServiceBusClient("Endpoint=sb://remscomm.servicebus.windows.net/;SharedAccessKeyName=dashboard-express;SharedAccessKey=v8rJ+T/HqTWa3OoWBvGlnWEBjyMBD0+7V+ASbL/Wluw=");

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app, connection, log) {
  app.post('/sendSNMPRequest', bodyParser.json(), (req, res) => {
    console.log("New SNMP Request set");
    console.log(JSON.stringify(req.body))
    const sender = sbClient.createSender(req.body["retailer"].toLowerCase());
    InsertAuditEntry('sendMessage', null, req.body, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: req.body["retailer"].toLowerCase() })
    res.send(sender.sendMessages({ "body": req.body }));
  })

  app.get('/getSNMPConfig', (req, res) => {
    let snmpDatabase = azureClient.db("pas_software_distribution").collection("config-files");
    if (req.query["sName"] != undefined && req.query["aName"] != undefined) {
      snmpDatabase.findOne({
        storeName: req.query["sName"],
        agentName: req.query["aName"],
        Retailer: req.query["retailerId"]
      }, function (err, result) {
        if (err || result === null) {
          log.info(`GET store: ${req.query["sName"]} and agent: ${req.query["aName"]}`);
          if (err) {
            log.error(err);
          }
          res.send(err);
        } else {
          log.info(`GET ${req.query}`);
          console.log(result.values);
          res.send(result.values);
        }
      });
    }
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

  app.get("/registers/versions", async (req, res) => {
    let versions = {}
    if (req.query["tenantId"] === undefined) {
      let docs = await azureClient.db("pas_software_distribution").collection("agents").distinct("versions", { "retailer_id": req.query["retailerId"] })
      for (var y of docs) {
        if (!versions[Object.keys(y)[0]]) versions[Object.keys(y)[0]] = []
        if (versions[Object.keys(y)[0]].indexOf(y[Object.keys(y)[0]]) == -1) {
          versions[Object.keys(y)[0]].push(y[Object.keys(y)[0]])
        }
      }
      res.send(versions)
    } else {
      let docs = await azureClient.db("pas_software_distribution").collection("agents").distinct("versions", { "retailer_id": req.query["retailerId"], "tenant_id": req.query["tenantId"] })
      for (var y of docs) {
        if (!versions[Object.keys(y)[0]]) versions[Object.keys(y)[0]] = []
        if (versions[Object.keys(y)[0]].indexOf(y[Object.keys(y)[0]]) == -1) {
          versions[Object.keys(y)[0]].push(y[Object.keys(y)[0]])
        }
      }
      res.send(versions)
    }

  })

  app.get('/registers/extracts', (req, res) => {
    console.log("get /registers/extracts with: ", req.query)
    if (req.query["tenantId"] === null) {
      var results = []
      var snapshots = azureClient.db("pas_reloads").collection("extracts");
      let query = { "Retailer": req.query["retailerId"] }
      if ("Store" in req.query) query["Store"] = req.query["Store"]
      snapshots.find(query).toArray(function (err, result) {
        results = result;
        let modifiedResults = []
        for (var x of results) {
          var y = x
          y["InStore"] = x["location"]["Store"]
          y["Download"] = x["location"]["URL"]
          y["Version"] = x["values"]["Version"]
          y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
          y["ExtractType"] = x["values"]["ExtractType"]
          y["State"] = x["values"]["State"]
          y["Anprompt_Line1"] = x["values"]["Anprompt_Line1"]
          modifiedResults.push(y)
        }
        res.send(modifiedResults)
      });
    } else {
      var results = []
      var snapshots = azureClient.db("pas_reloads").collection("extracts");
      let query = { "Retailer": req.query["retailerId"], "tenant_id": req.query["tenantId"] }
      snapshots.find(query).toArray(function (err, result) {
        results = result;
        let modifiedResults = []
        for (var x of results) {
          var y = x
          y["InStore"] = x["location"]["Store"]
          y["Download"] = x["location"]["URL"]
          y["Version"] = x["values"]["Version"]
          y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
          y["ExtractType"] = x["values"]["ExtractType"]
          y["State"] = x["values"]["State"]
          y["Anprompt_Line1"] = x["values"]["Anprompt_Line1"]
          modifiedResults.push(y)
        }
        res.send(modifiedResults)
      })
    }
  });

  app.get('/registers/extractsForStore', (req, res) => {
    var snapshots = azureClient.db("pas_reloads").collection("extracts");
    let query = {}
    if (req.query["tenantId"] === undefined) {
      query = { Retailer: req.query.retailerId, Store: req.query.storeName }
    } else {
      query = { Retailer: req.query.retailerId, Store: req.query.storeName, tenant_id: req.query.tenantId }
    }
    snapshots.find(query).toArray(function (err, results) {
      if (err) {
        const msg = { "error": err }
        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
        throw err
      } else if (!results) {
        const msg = { "message": "No dumps found for store" }
        res.status(statusCode.NO_CONTENT).json(msg);
      } else {
        let modifiedResults = []
        for (var x of results) {
          var y = x
          y["InStore"] = x["location"]["Store"]
          y["Download"] = x["location"]["URL"]
          y["Version"] = x["values"]["Version"]
          y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
          y["ExtractType"] = x["values"]["ExtractType"]
          y["State"] = x["values"]["State"]
          y["Anprompt_Line1"] = x["values"]["Anprompt_Line1"]
          modifiedResults.push(y)
        }
        res.send(modifiedResults)
      }
    });
  });

  app.get('/registers/extracts/:string', (req, res) => {
    console.log('registers/extracts/:string called with: ', req.params)
    j = JSON.parse(atob(req.params["string"]))
    msgSent = {
      "body": {
        "retailer": j.Retailer,
        "store": j.Store,
        "filename": j.values.File
      }
    };
    const sender = sbClient.createSender(j.Retailer.toLowerCase());
    InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: j.Retailer.toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  })


  app.post("/registers/requestDump/", bodyParser.json(), (req, res) => {
    console.log('requestDump with: ', req.body, req.query)
    msgSent = {
      "body": {
        "retailer": req.query["retailerId"],
        "tenant": req.query["tenantId"],
        "store": req.body["storeName"],
        "agent": req.body["agent"],
        "dataCapture": req.body["dataCapture"]
      }
    };
    const sender = sbClient.createSender(req.query["retailerId"].toLowerCase());
    InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: req.query["retailerId"].toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  })

  app.post("/registers/requestRemsDump/", bodyParser.json(), (req, res) => {
    console.log('registers/requestRemsDump with: ', req)
    msgSent = {
      "body": {
        "retailer": req.body['retailer'],
        "dataCapture": "REMS",
        "remsId": req.query["remsId"]
      }
    };
    const sender = sbClient.createSender(req.body["retailer"].toLowerCase());
    InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: req.body["retailer"].toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  })

  app.get('/registers/captures', (req, res) => {
    console.log('get registers/captures: ', req.query)
    var results = []
    var snapshots = azureClient.db("pas_reloads").collection("captures");

    if (req.query["tenantId"] === null) {
      snapshots.find({ "Retailer": req.query["retailerId"] }).toArray(function (err, result) {
        results = result;
        let modifiedResults = []
        for (var x of results) {
          var y = x

          y["Download"] = x["location"]["URL"]
          y["SBreqLink"] = "/api/registers/captures/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
          y["CaptureType"] = x["values"]["CaptureType"]
          if (x["values"]["Agent"]) {
            y["Agent"] = x["values"]["Agent"]
          } else {
            y["Agent"] = "REMS"
          }
          if (!y["Store"])
            y["Store"] = "REMS"
          y["CaptureSource"] = x["values"]["CaptureSource"]

          modifiedResults.push(y)
        }
        res.send(modifiedResults)
      });
    } else {
      let modifiedResults = []
      snapshots.find({ "Retailer": req.query["retailerId"] }).forEach(function (result) {
        if (result.values.CaptureSource === 'REMS' && req.query["isAdmin"] === 'true') {
          var y = result
          y["Download"] = result["location"]["URL"]
          y["SBreqLink"] = "/api/registers/captures/" + btoa(unescape(encodeURIComponent(JSON.stringify(result).replace("/\s\g", ""))))
          y["CaptureType"] = result["values"]["CaptureType"]
          if (result["values"]["Agent"]) {
            y["Agent"] = result["values"]["Agent"]
          } else {
            y["Agent"] = "REMS"
          }
          if (!y["Store"])
            y["Store"] = "REMS"
          y["CaptureSource"] = result["values"]["CaptureSource"]
          modifiedResults.push(y)
        }
      }).then(() => {
        snapshots.find({ "Retailer": req.query["retailerId"], "tenant_id": req.query["tenantId"] }).forEach(function (result) {
          var y = result
          y["Download"] = result["location"]["URL"]
          y["SBreqLink"] = "/api/registers/captures/" + btoa(unescape(encodeURIComponent(JSON.stringify(result).replace("/\s\g", ""))))
          y["CaptureType"] = result["values"]["CaptureType"]
          if (result["values"]["Agent"]) {
            y["Agent"] = result["values"]["Agent"]
          } else {
            y["Agent"] = "REMS"
          }
          if (!y["Store"])
            y["Store"] = "REMS"
          y["CaptureSource"] = result["values"]["CaptureSource"]

          modifiedResults.push(y)
        }).then(() => {
          res.send(modifiedResults)
        })
      })
    }
  });

  app.get('/registers/captures/:string', (req, res) => {
    j = JSON.parse(atob(req.params["string"]))
    console.log('request file, registers/captures/:string - ', j)
    msgSent = {
      "body": {
        "retailer": j.Retailer,
        "store": j.Store,
        "filename": j.values.File
      }
    };
    const sender = sbClient.createSender(j.Retailer.toLowerCase());
    // InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: j.Retailer.toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  });

  app.get('/registers/remscapture/:string', (req, res) => {
    j = JSON.parse(atob(req.params["string"]))
    msgSent = {
      "body": {
        "retailer": req.cookies["retailerId"],
        "fileName": req.params["string"]
      }
    };
    const sender = sbClient.createSender(req.cookies["retailerId"].toLowerCase());
    InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: req.cookies["retailerId"].toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  });

  app.get('/registers/commands/:string', (req, res) => {
    j = JSON.parse(atob(req.params["string"]))
    msgSent = {
      "body": {
        "retailer": j.Retailer,
        "tenant": j.Tenant,
        "store": j.Store,
        "agent": j.Agent,
        "command": j.Command
      }
    };
    const sender = sbClient.createSender(j.Retailer.toLowerCase());
    InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: j.Retailer.toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  });

  app.get("/registers/installPas", bodyParser.json(), (req, res) => {
    msgSent = {
      "body": {
        "retailer": req.query.retailer_id,
        "store": req.query.store,
        "agent": req.query.agent,
        "Install": "PAS"
      }
    };
    const sender = sbClient.createSender(req.query["retailer_id"].toLowerCase());
    InsertAuditEntry('sendMessage', null, msgSent, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: req.query["retailer_id"].toLowerCase() })
    res.send(sender.sendMessages(msgSent));
  })

}

