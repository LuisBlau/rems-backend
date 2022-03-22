// Std Library
const { readFileSync } = require('fs')
const path = require('path')
const multiparty = require('multiparty');
const fs = require('fs');
const readline = require('readline');
var bodyParser = require('body-parser');
const _ = require('lodash');
const { isRegExp } = require('lodash');
const statusCode = require('http-status-codes').StatusCodes

// setup dirs
var uploadDir = process.env.REMS_HOME + "/uploads";

//setup azure connections
var azureClient = new require("mongodb").MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

//find retailer id
var retailerId;
readRetailerId();



function readRetailerId() {
  const fileStream = fs.createReadStream(process.env.REMS_HOME +"/etc/com.toshibacommerce.service.cloudforwarder.cfg");

  const lineReader = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  lineReader.on('line', function (line) {
    if ( line.includes("retailer-torico-id") )
    {
        var values = line.split("=");
        retailerId = values[1];
    }
  });

}

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
  app.post("/REMS/uploadfile", (req,res) => {
    console.log("request recieved")
    var form = new multiparty.Form();
    var filename;
	  res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('received upload:\n\n');
    form.parse(req, function(err, fields, files) {
      if (!fs.existsSync(uploadDir)){
        fs.mkdirSync(uploadDir);
      }
	  filename = files["file"][0].originalFilename;
	    //query biggest index
      var uploads = azureClient.db("pas_software_distribution").collection("uploads");
      var results = [];
      uploads.find({retailer_id:retailerId}).sort({id:-1}).limit(1).toArray(function(err, result){
        results = result;
        var index = 0;
        
        if ( results.length > 0) {
          index = results[0].id;
        }
        index++;
        console.log("New index "+index);
        var currentdate = new Date();
        var datetime = currentdate.getFullYear() + "-"
                  + ((currentdate.getMonth()+1 < 10)?"0":"")+(currentdate.getMonth()+1) + "-"
                  + ((currentdate.getDate() < 10)?"0":"")+currentdate.getDate() + " "
                  + ((currentdate.getHours() < 10)?"0":"")+currentdate.getHours() + ":"
                  + ((currentdate.getMinutes() < 10)?"0":"")+currentdate.getMinutes() + ":"
                  + ((currentdate.getSeconds() < 10)?"0":"")+currentdate.getSeconds();

        
        let newFileName = uploadDir + "/" + index.toString() + ".upload"
        fs.copyFile(files["file"][0].path, newFileName, (err) => {
            if (err) throw err;
        });
        
        var newFile = {id:index,retailer_id: retailerId, filename:filename, inserted:currentdate.getTime(),timestamp:datetime,archived:"false",description:fields["description"][0]};
        uploads.insertOne(newFile, function(err, res) {
          if (err) throw err;
        });

      });
      res.send()
    });

  });

  app.get('/REMS/uploads', (req, res) => {
    var results = []
    var uploads = azureClient.db("pas_software_distribution").collection("uploads");
    uploads.find( {retailer_id:retailerId}).toArray(function(err, result){
      results = result;
      console.log(result)

    res.send(results)
    });
  });

  app.post('/sendCommand',bodyParser.json(), (req, res) => {
    console.log("New command set");
    console.log(JSON.stringify(req.body))
    
    //query biggest index
    var deployConfig = azureClient.db("pas_software_distribution").collection("deploy-config");
    var results = [];
    deployConfig.find({retailer_id:retailerId}).sort({id:-1}).limit(1).toArray(function(err, result){
      results = result;
      var index = 0;
        
      if ( results.length > 0) {
        index = results[0].id;
      }
      index++;
    
      var toInsert = {
        id:index,
        name:req.body.name,
        retailer_id:retailerId,
        steps:[]
      //  config_steps:req.body.steps
      }
      
      for( var i=0; i<req.body.steps.length; i++) {
        console.log("Step "+i+" type="+req.body.steps[i].type)
        toInsert.steps.push( {
          type:req.body.steps[i].type,
          ...req.body.steps[i].arguments
        })
      }

      console.log(JSON.stringify(toInsert));

      deployConfig.insertOne(toInsert, function(err, res) {
        if (err) throw err;
      });
      console.log("Inserted");
  })
  })

    app.get('/REMS/deploys', (req, res) => {
        var results = []
  		let filters = {}
	  	if(req.query.store) filters.storeName = {$regex:".*" + req.query.store + ".*"}
		  if(req.query.package && parseInt(req.query.package)>0) filters.config_id = parseInt(req.query.package)

      console.log("Filter")
      console.log(JSON.stringify({ retailer_id: retailerId,...filters}))

      var deploys = azureClient.db("pas_software_distribution").collection("deployments");
        //deploys.find({ retailer_id: retailerId, status: { $ne: "Succeeded" } }).toArray(function (err, result) {
        deploys.find({ retailer_id: retailerId,...filters}).toArray(function (err, result) {
            results = result;
            //console.log(result)
            res.send(results)
        });
    });

    app.get('/REMS/deploy-configs', (req, res) => {
        // console.log("GET deploy-configs request ")
        var results = [];
        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.find({ retailer_id: retailerId, name: { $ne: "Missing name" } }, {
            projection: { steps: false, retailer_id: false, _id: false }
        }).toArray(function (err, result) {
            results = result;
            res.send(results);
        });
    });

    app.post('/deploy-config', bodyParser.json(), (req, res) => {
        console.log("POST deploy-config recived", req.body)

        const dateTime = req.body.dateTime;
        const name = req.body.name
        const id = req.body.id

        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.findOne({ name: name, id: id }, function (err, config) {

            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!config) {
                const msg = { "message": "Deploy-Config: name and id does not exist" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                var record = {};
                record.id = 0
                record.retailer_id = config.retailer_id;
                record.config_id = config.id
                record.apply_time = dateTime;
                record.storeName = "";
                record.agentName = "";
                record.status = "Initial";
                record.steps = config.steps;
				record.package = config["name"]

                for (const i in record.steps) {
                    record.steps[i].status = 'Initial'
                    record.steps[i].output = []
                }

                const deployments = azureClient.db("pas_software_distribution").collection("deployments");
                deployments.find({}).sort({ id: -1 }).limit(1).toArray(function (err, maxResults) {

                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err
                    }

                    var maxId = maxResults[0].id;
                    var newRecords = [];
                    req.body.storeList.split(',').forEach(val => {
                        const info = val.split(':');
                        record.storeName = info[0].trim();
                        record.agentName = info[1].trim();
                        record.id = ++maxId;
                        newRecords.push(_.cloneDeep(record))
                    })

                    deployments.insertMany(newRecords, function (err, insertResults) {
                        if (err) {
                            const msg = { "error": err }
                            res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                            throw err
                        }

                        const msg = { "message": "Success" }
                        res.status(statusCode.OK).json(msg);
                    });

                });
            }
        })
    });

    app.get('/REMS/agents', (req, res) => {
        var results = [];
        const agents = azureClient.db("pas_software_distribution").collection("agents");
        agents.find({ retailer_id: retailerId }, {
            projection: { storeName: true, agentName: true, _id: false }
        }).toArray(function (err, agentList) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!agentList) {
                const msg = { "message": "Agents: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {

                res.status(statusCode.OK).json(agentList);
            }
        });
    });
}
