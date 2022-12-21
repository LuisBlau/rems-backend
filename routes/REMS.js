// Std Library
const { readFileSync } = require('fs')
const path = require('path')
const multiparty = require('multiparty');
const fs = require('fs');
var bodyParser = require('body-parser');
const _ = require('lodash');
const { filter } = require('lodash');
const statusCode = require('http-status-codes').StatusCodes
const mongodb = require("mongodb")
var {ObjectId} = require('mongodb')
const { BlobServiceClient } = require('@azure/storage-blob');
const extract = require('extract-zip')
require('dotenv').config()

// setup dirs
var uploadDir = process.cwd() + "/uploads";

/* cSpell:disable */
//setup azure connections
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();
/* cSpell:enable */

//find retailer id

function sendRelevantJSON(res, jsonPath) {
    res.send(JSON.parse(
        readFileSync(
            path.join(process.cwd(), 'Data', jsonPath)
        )
    ))
}

/*
 async map to look up any agents user did not supply
Input : stores is an array of the stores missing an agent where each has
{ index, - index into newRecord array to set the agent when it is found
  name - name of the store who's agent we need
}

Returns: An array with the agent included if found
{
    index, - index into newRecords to speed up assigning the agentName
    storeName, - the name of the store who's agent was requested
    agentName - agent name returned from DB ( null if none found)
}
or null if no work was done. i.e. input is an empty array. That keeps the caller
from having to follow two paths.
*/
async function lookupAgents(stores, retailer_id) {

    if (stores.length > 0) {
        const promises = stores.map(async store => {
            const agents = azureClient.db("pas_software_distribution").collection("agents");
            try {
                const response = await agents.findOne({
                    retailer_id: retailer_id,
                    storeName: store.name,
                    is_master: true
                })
                return {
                    index: store.index,
                    storeName: store.name,
                    agentName: (!response) ? null : response.agentName
                }
            }
            catch (error) {
                console.log("findone returned error : ", error);
                throw (error);
            }
        })
        return (await Promise.all(promises))
    }
    else {
        return null;
    }
}

async function extractZip(copyDestination, targetDirectory) {
    try {
        await extract(copyDestination, { dir: targetDirectory })
   } catch (err) {
         console.log(err.message);
   }
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

    app.post("/REMS/uploadfile", async (req, res) => {
        const retailerId = req.cookies["retailerId"]
        const allowedExtensions = [".zip", ".upload"];
        var form = new multiparty.Form();
        var filename;
        var currentdate = new Date();

        //uploadDir = "./uploads"
        var targetDirectory = uploadDir + "/" + currentdate.getTime();
        form.parse(req, async function (err, fields, files) {
            // check if the upload directory exists
            if (!fs.existsSync(uploadDir)) {
                // if not, create it
                fs.mkdirSync(uploadDir);
            }
            
            // uploaded file's name and extension
            filename = files["file"][0].originalFilename;
            const fileExtension = path.extname(filename);
            // var source = uploadDir + "/" + filename;

            if (!fs.existsSync(targetDirectory)) {
                fs.mkdirSync(targetDirectory);
            }

            var uploads = azureClient.db("pas_software_distribution").collection("uploads");
            const versionPackages = [];

            var datetime = currentdate.toISOString()
                .replace(/T/, ' ')      // replace T with a space
                .replace(/\..+/, '')     // delete the dot and everything after

            // sets up file name as the upload directory (./uploads) 
            // with the file name and '.upload' extension appended
            // where file name is the uniqueUploadId (random GUID)
            //TODO: UPDATE THIS TO DO WHAT IT DID BEFORE IN THE CASE OF NON-ZIP FILES?
            let copyDestination = uploadDir + "/" + filename//index.toString() + ".upload"
            // copies file from appdata directory 
            // (temp clone of uploaded file) to newFileName directory 
            // as copyDestination
            fs.copyFileSync(files["file"][0].path, copyDestination);
            
            if(allowedExtensions.includes(fileExtension)) {
                await extractZip(copyDestination, targetDirectory);

                // 4690 product file pattern
                let fileNamePattern = /^ADXC.*T{1}.*D{1}.DAT$/;
                var extractfiles = fs.readdirSync(targetDirectory);
                extractfiles.forEach(extractFile => {
                    if(path.extname(extractFile) == ".DAT" && fileNamePattern.test(extractFile)) {
                        const syncData = fs.readFileSync(targetDirectory + '/' + extractFile, {encoding:'utf8', flag:'r'});
                        if(syncData.length > 100) {
                            let productName = (((syncData.substring(26, 57)).replace(/ +(?= )/g, '')).replace(/\0.*$/g,'')).replace(/^\s+|\s+$/g,'');
                            let cdNum =  syncData.substring(88, 92);
                            let productRelease = syncData.substring(92, 95);

                            const package = { productName : productName, version : cdNum+"-"+productRelease };
                            versionPackages.push(package);
                        }
                    }
                })
            }
            
            try {
                const query = { retailer_id: retailerId };
                const options = { sort: { "id": -1 }};
                var results = [];
                var index = 0;
                uploads.find(query, options).limit(1).toArray(async function (err, result) {
                    results = result;
                    // snags the index of the newest upload
                    if (results.length > 0) {
                        index = results[0].id
                    }
                    // increments the index
                    index++;
                    let azureFileName = retailerId + "-" + index.toString() + ".upload";
                    const AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=pasfileuploads;AccountKey=6Wh7jcTvZYyAGyiyq7nZWcbZHZyNPDnrVLY6OgeDv3CmhRHDBdzWc8dAAgigrEZkxYFyQR2UJ6AO+ASt/Q2DQg==;EndpointSuffix=core.windows.net";

                    try {
                        const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
                            
                        // Create a unique name for the container
                        const containerName = "rems-upload";
                        // Get a reference to a container
                        const containerClient = blobServiceClient.getContainerClient(containerName);
                        
                        // Get a block blob client
                        const blockBlobClient = containerClient.getBlockBlobClient(azureFileName);
                                
                        let fileSize = 0;
                        fs.stat(files["file"][0].path, (err, stats) => {
                            if (err) {
                                console.log(`File doesn't exist.`);
                            } else {
                                fileSize = stats.size;
                            }
                        });

                        // Upload data to the blob
                        var uploadBlobResponse = await blockBlobClient.uploadFile(files["file"][0].path)
                        console.log( (fileSize / 1048576).toFixed(2) + "mb blob was uploaded successfully. requestId: ", uploadBlobResponse.requestId );                                        
                    }catch (error) {
                        console.log("Error occurred while file uploading to Azure");
                        throw error;
                    }   

                    var newFile = { 
                        id: index, 
                        retailer_id: retailerId, 
                        filename: filename, 
                        inserted: currentdate.getTime(), 
                        timestamp: datetime, 
                        archived: false, 
                        description: fields["description"][0], 
                        packages : versionPackages 
                    };
    
                    // once file is uploaded, make a record in the uploads collection
                    uploads.insertOne(newFile);
                    res.writeHead(200, { 'content-type': 'text/plain' });
                    res.write('received upload:\n\n');
                    res.send()
                })

            } catch (ex) {
                res.writeHead(500, {'content-type': 'text/plain'});
                res.write('upload error');
                res.send()
                console.log(ex.message);
                throw ex;
            };
        });
    });


    app.get('/REMS/uploads', (req, res) => {
        let results = []
		let query = { retailer_id: req.cookies["retailerId"] }
		if(!(req.query?.archived)) query["archived"] = false
        var uploads = azureClient.db("pas_software_distribution").collection("uploads");
        uploads.find(query).toArray(function (err, result) {
            results = result;

            res.send(results)
        });
    });
	app.get("/REMS/deleteExistingList", (req,res) => {
		console.log(req.query.id)
		azureClient.db("pas_software_distribution").collection("store-list").deleteOne({"_id":ObjectId(req.query.id)},function (err,result) {
			res.sendStatus(200)
		})
	})
    app.post('/sendCommand', bodyParser.json(), (req, res) => {
        const retailerId = req.cookies["retailerId"]
        //query biggest index
        var deployConfig = azureClient.db("pas_software_distribution").collection("deploy-config");
        var results = [];
        deployConfig.find({ retailer_id: retailerId }).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {

            if (err_find) {
                const msg = { "error": err_find }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err_find
            }

            var index = 0;
            if (result.length > 0) {
                index = result[0].id;
            }
            index++;

            var toInsert = {
                id: index,
                name: req.body.name,
                retailer_id: retailerId ,
                steps: []
                //  config_steps:req.body.steps
            }

            for (var i = 0; i < req.body.steps.length; i++) {
                toInsert.steps.push({
                    type: req.body.steps[i].type,
                    ...req.body.steps[i].arguments
                })
            }
            deployConfig.updateOne({"name": req.body.name, "retailer_id": retailerId},{"$set":toInsert},{upsert:true}, function (err, result) {
                if (err) {
                    const msg = { "error": err }
                    //res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err;
                }
            });

                const msg = { "message": "Success" }
                res.status(statusCode.OK).json(msg);
        })
    })

    app.get('/REMS/deploys', (req, res) => { //TODO: refactor to a POST request
        var results = []
        let filters = {}
        var maxRecords = 0;
        if (req.query.store) filters.storeName = { $regex: ".*" + req.query.store + ".*" }
        if (req.query.package && parseInt(req.query.package) > 0) filters.config_id = parseInt(req.query.package)
        if (req.query.records) maxRecords = parseInt(req.query.records);
        if (req.query.status && "All" !== req.query.status) filters.status = req.query.status;
        var deploys = azureClient.db("pas_software_distribution").collection("deployments");
        //deploys.find({ retailer_id: retailerId, status: { $ne: "Succeeded" } }).toArray(function (err, result) {
        deploys.find({ retailer_id: req.cookies["retailerId"], ...filters }).sort({ id: -1}).limit(maxRecords).toArray(function (err, result) {
            results = result;
            res.send(results)
        });
    });
    
    app.post('/REMS/get-deploys', (req,res) => {
		
	});

    app.get('/REMS/deploy-configs', (req, res) => {
        var results = [];
        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.find({ retailer_id: req.cookies["retailerId"], name: { $ne: "Missing name" } }).toArray(function (err, result) {
            results = result;
            res.send(results);
        });
    });

    app.get('/REMS/delete-deploy-config', (req, res) => {
        var id = req.query.id;
        var dbQuery = { retailer_id: req.cookies["retailerId"], id: parseInt(id) };
        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.deleteOne(dbQuery, function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                return;
            } else {
                const msg = { "message": "Deploy-Config deleted successfully" }
                res.status(statusCode.OK).json(msg);
                return;
            }
        });
    });
	app.get("/REMS/setArchive", (req,res) => {
		azureClient.db("pas_software_distribution").collection("uploads").updateOne({"_id":req.query.id},{"$set":{"archived":(req.query.archived == "true")}})
		res.send(200)
	})
    app.post('/deploy-schedule', bodyParser.json(), (req, res) => {
        console.log("POST deploy-schedule received : ", req.body)

        const dateTime = req.body["dateTime"];
        const name = req.body.name
        const id = req.body.id
        const retailer_id = req.cookies["retailerId"]
        let storeList = req.body.storeList

        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.findOne({ retailer_id: req.cookies["retailerId"], name: name, id: id }, function (err, config) {

            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                return;
            } else if (!config) {
                const msg = { "message": "Deploy-Config: name and id does not exist" }
                res.status(statusCode.NO_CONTENT).json(msg);
                return;
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

                var newRecords = [];
                var missingAgent = [];
                const deployments = azureClient.db("pas_software_distribution").collection("deployments");
                deployments.find({}).sort({ id: -1 }).limit(1).toArray(function (err, maxResults) {

                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        return;
                    }

                    var maxId = 0;
                    if (maxResults.length > 0) {
                        maxId = maxResults[0].id;
                    }

                    /* I think this maxID++ was causing us to increment the id by 2. We add one here and one when I assign the id
                    to the record in the next section below.  I am going to comment out for now, but it can be removed
                    later. I just left it here so I could add this explanation. :) */
                    //maxId++;

                    // Replace line endings with commas and proceed. This allows the user to use a list from excell ect.
                    storeList = storeList.replace(/(?:\r\n|\r|\n)/g, ',');
                    // Incase there is a , at the end of a line.
                    storeList = storeList.replace(/(?:,)+/g, ',');

                    var indx = 0;
                
                    storeList.split(',').forEach(val => {

                        /* The line break substitution above may add an extra comma
                            to the end of the data. This check makes sure we
                            don't process it */
                        if (val.length > 0) {
                            const info = val.split(':');
                            if (info.length == 2) {
                                record.storeName = info[0].trim();
                                record.agentName = info[1].trim();
                                record.id = ++maxId;
                                newRecords.push(_.cloneDeep(record))
                            }
                            else if (info.length == 1) {
                                var name = info[0].trim();
                                missingAgent.push({ index: indx, name: name });
                                record.storeName = name;
                                record.id = ++maxId;
                                newRecords.push(_.cloneDeep(record))
                            }
                            else {
                                const msg = { "message": "Error parsing store list!" }
                                res.status(statusCode.NOT_MODIFIED).json(msg);
                                return;
                            }
                            //clear for next loop incase we are missing anything
                            record.storeName = ""
                            record.agentName = ""
                            indx++;
                        }
                    })


                    lookupAgents(missingAgent,retailer_id).then(agents => {
                        var noAgent = "";
                        if (agents) {
                            agents.map(agent => {
                                if (agent.agentName) {
                                    newRecords[agent.index].agentName = agent.agentName;
                                }
                                else {
                                    noAgent = noAgent + agent.storeName + " "
                                }
                            })
                        }

                        if (noAgent.length > 0) {
                            /* I wanted to send an error here, but we cannot add a message to an error response
                            So we have to check if the message == Success on the client side*/
                            const msg = "Agent(s) not found for store(s) [ " + noAgent + "]"
                            res.status(statusCode.OK).json(msg)
                            return;
                        }
                        else {
                            deployments.insertMany(newRecords, function (err, insertResults) {
                                if (err) {
                                    const msg = { "error": err }
                                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                                    return
                                }
                            });
                            const msg = { "message": "Success" }
                            res.status(statusCode.OK).json(msg);
                            return;
                        }
                    }).catch(error => {
                        const msg = { "error": error }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        return;
                    });
                }); // deployment read from DB for max index
            }// if config lookup was good.
        }) // config lookup from database
    });

    app.get('/REMS/heartbeat', (req, res) => {
        console.log("Get /REMS/heartbeat received : ", req.query)
        var results = []
        let filters = {}

        if (req.query.Store !== undefined ) {
            console.log("Heartbeat search with store "+req.query.Store)
            filters.storeName=req.query.Store;
        }
        if (req.query.System !== undefined ) {
            console.log("Heartbeat search with System/agent "+req.query.System)
            filters.systemName=req.query.System;
        }

        const heartbeat = azureClient.db("pas_availability").collection("heartbeat");
        heartbeat.find({ Retailer: req.cookies["retailerId"], ...filters }).toArray(function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                const msg = { "message": "Heartbeat: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                results = result;
                res.send(results)
            }
        })
    });

    app.get('/REMS/rems', (req, res) => {
        console.log("Get /REMS/rems received : ", req.query)
        var results = [];
        let filters = {}

        const agents = azureClient.db("pas_software_distribution").collection("rems");
        agents.find({ retailer_id: req.cookies["retailerId"] }, {}).toArray(function (err, rems) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!rems) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                console.log("sending rems info : ", rems[0])
                res.status(statusCode.OK).json(rems[0]);
            }
        });
    });

    app.get('/REMS/agents', (req, res) => {
        console.log("Get /REMS/agents received : ", req.query);
        var results = [];
        let filters = {};

        if (req.query.agentName) filters.agentName = req.query.agentName;
        if (req.query.onlyMasters == 'true') {
            console.log("onlyMasters : ", req.query.onlyMasters);
            filters.is_master = true;
        }

        if (req.query.store !== undefined ) {
            console.log("Agent search with store "+req.query.store);
            filters.storeName=req.query.store;
        }

        var agents = azureClient.db("pas_software_distribution").collection("agents");
        agents.find({ retailer_id: req.cookies["retailerId"], ...filters }, {}).toArray(function (err, agentList) {
            if (err) {
                const msg = { "error": err };
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw err;
            } else if (!agentList) {
                const msg = { "message": "Agents: Error reading from server" };
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                console.log("sending agentList : ", agentList);
                res.status(statusCode.OK).json(agentList);
            }
        });
    });

    app.get('/REMS/stores', (req, res) => {
        console.log("Get /REMS/stores received : ", req.query)
        var results = [];
        let filters = {}

        const agents = azureClient.db("pas_software_distribution").collection("stores");
        agents.find({ retailer_id: req.cookies["retailerId"], ...filters }, {}).toArray(function (err, agentList) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!agentList) {
                const msg = { "message": "Agents: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                console.log("sending storeList : ", agentList)
                res.status(statusCode.OK).json(agentList);
            }
        });
    });

    app.post('/deploy-cancel', bodyParser.json(), (request, response) => {
        console.log("POST deploy-update received : ", request.body)
        const storeName = request.body.storeName;
        const id = request.body.id;
        const newStatus = "Cancel";

        const deployQuery = { retailer_id: request.cookies["retailerId"], storeName: storeName, id: parseInt(id), status: { $in: ["initial", "Initial", "Pending", "pending"] } };
        const deployUpdate = { $set: { status: newStatus } }

        const deploys = azureClient.db("pas_software_distribution").collection("deployments")
        deploys.updateOne(deployQuery, deployUpdate, function (error, upResult) {
            if (error) {
                console.log("Update error : ", error)
                const msg = { "message": "Error Canceling Deployment" }
                response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw (error)
                return;
            }

            if (upResult) {
                const responseInfo =
                    " [ store: " + storeName +
                    " id: " + id +
                    " n: " + upResult.result.n +
                    " nModified: " + upResult.result.nModified +
                    " ]"

                if (upResult.result.n <= 0) {
                    console.log("Cancel Deployment Find FAIL : ", responseInfo)
                    const msg = { "message": "Unable to find that Deployment" }
                    response.status(statusCode.NOT_FOUND).json(msg);
                    return;
                }
                else if (upResult.result.nModified <= 0) {
                    console.log("Cancel Deployment Modify FAIL : ", responseInfo)
                    const msg = { "message": "Unable to cancel that Deployment" }
                    response.status(statusCode.NOT_MODIFIED).json(msg);
                    return;
                }
                else {
                    console.log("Cancel Deployment SUCCESS : ", responseInfo)
                    const msg = { "message": "SUCCESS" }
                    response.status(statusCode.OK).json(msg);
                    return;
                }
            }
            console.log("How did I get here? : store : " + storeName + " id : " + id);
            const msg = { "message": "Unknown Error" }
            response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
            return;
        });
    });

    app.get('/REMS/store-list', async (req, res) => {
        var results = []

        console.log(JSON.stringify({ retailer_id: req.cookies["retailerId"]}));

        var storeList = azureClient.db("pas_software_distribution").collection("store-list");
        filters =  {retailer_id: req.cookies["retailerId"]}
		if(req.query["version"]) {
			var version_split = req.query["version"].split("\n")
			var sw = version_split[0]
			var version = version_split[1]
			var agents = await azureClient.db("pas_software_distribution").collection("agents").find({"version":{"$elemMatch": { sw: version } }}).toArray()
			console.log(agents)
			filters["agents"] = {"$in":agents}
		}
        storeList.find(filters).toArray(function (err, result) {
            
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                res.send();
            } else if (!result) {
                const msg = { "message": "No store available for this retailer" }
                res.status(statusCode.NO_CONTENT).json(msg);
                res.send();
            }else {
                results = result;
                res.send(results)
            }

        });
    });

    app.get('/REMS/agentScreenShot', (req, res) => {
        var results = []
        let filters = {}
        if (req.query.storeName) filters.storeName = req.query.storeName;
        if (req.query.agentName) filters.agentName = req.query.agentName;
        
        console.log("agentScreenShot "+JSON.stringify(filters));
        console.log(JSON.stringify({ retailer_id: req.cookies["retailerId"], ...filters}));

        var deploys = azureClient.db("pas_software_distribution").collection("agent-screenshot");
        
        deploys.find({ retailer_id: req.cookies["retailerId"], ...filters}).toArray(function (err, result) {
            
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                res.send();
            } else if (!result) {
                const msg = { "message": "No store available for this retailer" }
                res.status(statusCode.NO_CONTENT).json(msg);
                res.send();
            }else {
                res.send(result[0])
            }

        });
    });


    app.get('/REMS/specific-store-agent-names', (req, res) => {
        var results = []
        let filters = {}
        var maxRecords = 0;
        if (req.query.storeId) filters.id = req.query.storeId;

        console.log(JSON.stringify({ retailer_id: req.cookies["retailerId"], ...filters}));

        var deploys = azureClient.db("pas_software_distribution").collection("store-list");
        
        deploys.find({ retailer_id: req.cookies["retailerId"], ...filters}).toArray(function (err, result) {
            
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                res.send();
            } else if (!result) {
                const msg = { "message": "No store available for this retailer" }
                res.status(statusCode.NO_CONTENT).json(msg);
                res.send();
            }else {
                result.forEach(function(item) {
                    results = results.concat(item.agents);
                });
                res.send(results)
            }

        });
    });

    app.post('/REMS/save-store-data', bodyParser.json(), (req, res) => {
        let filters = {};
        if (req.body.id) filters.id = req.body.id;

        //query biggest index
        var deployConfig = azureClient.db("pas_software_distribution").collection("store-list");
        var results = [];
        deployConfig.find({ retailer_id: req.cookies["retailerId"], ...filter }).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {

            if (err_find) {
                const msg = { "error": err_find }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err_find
            }

            if(req.body.id) {

                const storeListUpdateQuery = { retailer_id: req.cookies["retailerId"], list_name: req.body.list_name, id: req.body.id };
                const storeListUpdateAgent = { $set: { agents: req.body.agents } }
    
                deployConfig.updateOne(storeListUpdateQuery, storeListUpdateAgent, function (err, res) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    }
                });    

            } else {

                var index = 0;
                if (result.length > 0) {
                    index = result[0].id;
                }
                index++;

                var toInsert = {
                    id: index.toString(),
                    list_name: req.body.list_name,
                    retailer_id: req.cookies["retailerId"],
                    agents: []
                }
    
                toInsert.agents = toInsert.agents.concat(req.body.agents);    
                deployConfig.insertOne(toInsert, function (err, res) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    }
                });    
            }

            const msg = { "message": "Success" }
            res.status(statusCode.OK).json(msg);
        });
    });

    app.get('/REMS/retailerids', (req, res) => {
        console.log("Get /REMS/rems received : ", req.query)
        var results = [];
        let filters = {}

        const agents = azureClient.db("pas_software_distribution").collection("rems");
        agents.find({ }, {projection: { retailer_id: true, _id: false}}).toArray(function (err, rems) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!rems) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                output = rems.map(function(item) { return item.retailer_id; })
                console.log("sending rems info : ", output)

                res.status(statusCode.OK).json(output);
            }
        });
    });
	app.get("/REMS/stores", (req,res) => {
		agents.find({"retailer_id": req.cookies["retailerId"]}).toArray(function (err, rems) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!rems) {
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                output = []
				for(x of rems)
					output.push(x.storeName)
                res.status(statusCode.OK).json(output);
            }
        });
	});

    app.get('/REMS/getRoleDetails', (req, res) => {
        var results = {}
        var userRoles = azureClient.db("pas_config").collection("user");
        userRoles.find({ email: req.query.email }).limit(1).toArray(function (err, result) {

            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            }

            if(result.length > 0) {
                results = result[0];
            }

            res.send(results)
        });
    });

    app.get('/REMS/getUserDetails', (req, res) => {
        var results = {}
        var userDetails = azureClient.db("pas_config").collection("user");
        userDetails.find({ email: req.query.email }).limit(1).toArray(function (err, result) {

            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            }

            if(result.length > 0) {
                results = result[0];
            }

            res.send(results)
        });
    });

    app.get('/REMS/getRetailerDetails', (req, res) => {
        var results = {}
        var retailerDetails = azureClient.db("pas_software_distribution").collection("retailers");
        retailerDetails.find({retailer_id: req.query.id}).limit(1).toArray(function (err, result) {
            console.log(req.query.id)
            console.log(result)
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            }

            if(result.length > 0) {
                results = result[0];
            }

            res.send(results)
        });
    });

}