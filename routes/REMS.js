// Std Library
const { readFileSync } = require('fs')
const path = require('path')
const multiparty = require('multiparty');
const fs = require('fs');
const readline = require('readline');
var bodyParser = require('body-parser');
const _ = require('lodash');
const { isRegExp, filter } = require('lodash');
const statusCode = require('http-status-codes').StatusCodes
const mongodb = require("mongodb")
const { BlobServiceClient } = require('@azure/storage-blob');
const { v1: uuidv1} = require('uuid');
const extract = require('extract-zip')
const glob = require('glob');
require('dotenv').config()

// setup dirs
var uploadDir = process.env.REMS_HOME + "/uploads";

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

async function fileUploadToAzure(srcFile, azureFileName) {
    console.log("Inside method of fileUploadToAzure");

    const AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=pasfileuploads;AccountKey=6Wh7jcTvZYyAGyiyq7nZWcbZHZyNPDnrVLY6OgeDv3CmhRHDBdzWc8dAAgigrEZkxYFyQR2UJ6AO+ASt/Q2DQg==;EndpointSuffix=core.windows.net";

    if (!AZURE_STORAGE_CONNECTION_STRING) {
        throw Error("Azure Storage Connection string not found");
    }

    try {

        const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
            
            // Create a unique name for the container
        const containerName = "rems-upload";
        console.log("\t", containerName);
        
        // Get a reference to a container
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        // Get a block blob client
        const blockBlobClient = containerClient.getBlockBlobClient(azureFileName);
        
        console.log("\nUploading to Azure storage as blob:\n\t", azureFileName);
        
        let fileSize = 0;
        await fs.stat(srcFile.path, (err, stats) => {
            if (err) {
                console.log(`File doesn't exist.`);
            } else {
                console.log(stats);
                fileSize = stats.size;
            }
        });
        
        // Upload data to the blob
        const uploadBlobResponse = await blockBlobClient.upload(srcFile.path, fileSize);
        console.log( "Blob was uploaded successfully. requestId: ", uploadBlobResponse.requestId );

    }catch (error) {
        console.log("Error occurred while file uploading to Azure");
        throw error;
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

    app.post("/REMS/uploadfile", (req, res) => {
        console.log("request received")
        const retailerId = req.cookies["retailerId"]
        const allowedExtensions = [".zip", ".upload"];
        var form = new multiparty.Form();
        var filename;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('received upload:\n\n');
        var currentdate = new Date();

        var targetDirectory = uploadDir + "/" + currentdate.getTime();

        form.parse(req, function (err, fields, files) {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir);
            }
            
            filename = files["file"][0].originalFilename;
            const fileExtension = path.extname(filename);
            var source = uploadDir + "/" + filename;

            if (!fs.existsSync(targetDirectory)) {
                fs.mkdirSync(targetDirectory);
            }

            //query biggest index
            var uploads = azureClient.db("pas_software_distribution").collection("uploads");
            var results = [];
            const versionPackages = [];
            uploads.find({ retailer_id: retailerId }).sort({ id: -1 }).limit(1).toArray(function (err, result) {
                results = result;
                var index = 0;

                if (results.length > 0) {
                    index = results[0].id;
                }
                index++;
                console.log("New index " + index);
                var datetime = currentdate.getFullYear() + "-"
                    + ((currentdate.getMonth() + 1 < 10) ? "0" : "") + (currentdate.getMonth() + 1) + "-"
                    + ((currentdate.getDate() < 10) ? "0" : "") + currentdate.getDate() + " "
                    + ((currentdate.getHours() < 10) ? "0" : "") + currentdate.getHours() + ":"
                    + ((currentdate.getMinutes() < 10) ? "0" : "") + currentdate.getMinutes() + ":"
                    + ((currentdate.getSeconds() < 10) ? "0" : "") + currentdate.getSeconds();


                let newFileName = uploadDir + "/" + index.toString() + ".upload"

                fs.copyFileSync(files["file"][0].path, newFileName);

                if(allowedExtensions.includes(fileExtension)) {
                    //extractZip(newFileName, targetDirectory);
                    try {
                        extract(newFileName, { dir: targetDirectory })
                        console.log('Extraction complete')
                    } catch (err) {
                          console.log(err.message);
                    }

                    let fileNamePattern = /^ADXC.*T{1}.*D{1}.DAT$/;
                    extractfiles = fs.readdirSync(uploadDir+"/1658460166336/");

                    extractfiles.forEach(extractFile => {
                        if(path.extname(extractFile) == ".DAT" && fileNamePattern.test(extractFile)) {
                            console.log(extractFile)
                            const syncData = fs.readFileSync(uploadDir+"/1658460166336/" + extractFile, {encoding:'utf8', flag:'r'});
                            if(syncData.length > 100) {
                                let productName = syncData.substring(27, 57);
                                let cdNum =  syncData.substring(88, 92);
                                let productRelease = syncData.substring(92, 95);
    
                                const package = { productName : productName, version : cdNum+"-"+productRelease };
                                versionPackages.push(package);
                            }
                        }
                    })

                    console.log(versionPackages);
                }
                
                let azureFileName = retailerId + "-" + index.toString() + ".upload"
                fileUploadToAzure(files["file"][0], azureFileName).then(() => {
                        console.log('Done');
                        var newFile = { id: index, retailer_id: retailerId, filename: filename, inserted: currentdate.getTime(), timestamp: datetime, archived: "false", description: fields["description"][0], packages : versionPackages };
                            uploads.insertOne(newFile, function (err, res) {
                                if (err) throw err;
                        });
                    })
                    .catch((ex) => {
                            console.log(ex.message);
                            throw ex;
                    });

            });
            res.send()
        });

    });


    app.get('/REMS/uploads', (req, res) => {
        var results = []
        var uploads = azureClient.db("pas_software_distribution").collection("uploads");
        uploads.find({ retailer_id: req.cookies["retailerId"] }).toArray(function (err, result) {
            results = result;
            console.log(result)

            res.send(results)
        });
    });

    app.post('/sendCommand', bodyParser.json(), (req, res) => {
        console.log("New command set");
        console.log(JSON.stringify(req.body))
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
                console.log("Step " + i + " type=" + req.body.steps[i].type)
                toInsert.steps.push({
                    type: req.body.steps[i].type,
                    ...req.body.steps[i].arguments
                })
            }
            console.log(JSON.stringify(toInsert));
            deployConfig.updateOne({"name": req.body.name},{"$set":toInsert},{upsert:true}, function (err, res) {
                if (err) {
                    const msg = { "error": err }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err;
                }
            });

                console.log("Inserted");
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

        // console.log("Filter")
        // console.log(JSON.stringify({ retailer_id: retailerId, ...filters }));
        // console.log(filters);

        var deploys = azureClient.db("pas_software_distribution").collection("deployments");
        //deploys.find({ retailer_id: retailerId, status: { $ne: "Succeeded" } }).toArray(function (err, result) {
        deploys.find({ retailer_id: req.cookies["retailerId"], ...filters }).sort({ id: -1}).limit(maxRecords).toArray(function (err, result) {
            results = result;
            // console.log(result)
            res.send(results)
        });
    });
    
    app.post('/REMS/get-deploys', (req,res) => {
		
	});

    app.get('/REMS/deploy-configs', (req, res) => {
        // console.log("GET deploy-configs request ")
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

    app.post('/deploy-schedule', bodyParser.json(), (req, res) => {
        console.log("POST deploy-schedule received : ", req.body)

        const dateTime = req.body["dateTime"];
        const name = req.body.name
        const id = req.body.id
        const retailer_id = req.cookies["retailerId"]
        let storeList = req.body.storeList
        let listNames = req.body.listNames

        if(listNames){
            var agentsNames = [];
            let filters = {};

            listNames.split(",").forEach (val => {
                
                filters.list_name = val;
                var storeListDbClient = azureClient.db("pas_software_distribution").collection("store-list");
                                
                storeListDbClient.findOne({ retailer_id: retailer_id, ...filters}, function (err, result) {
                    
                    if (err) {
                        const msg = { "error": err }
                        console.log(msg);
                    } else if (!result) {
                        console.log("No store available for this retailer");
                    }else {
                        agentsNames = agentsNames.concat(result.agents);
                        storeList = agentsNames.join();
                    }
                    
                });
            });                
        }

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

                    console.log(missingAgent);

                    lookupAgents(missingAgent,retailer_id).then(agents => {
                        var noAgent = "";
                        console.log(agents);
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
                        console.log(newRecords);

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
                console.log(results);
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
        console.log("Get /REMS/agents received : ", req.query)
		console.log(req.cookies["retailerId"])
        var results = [];
        let filters = {}

        if (req.query.agentName) filters.agentName = req.query.agentName;
        if (req.query.onlyMasters == 'true') {
            console.log("onlyMasters : ", req.query.onlyMasters)
            filters.is_master = true
        }

        if (req.query.store !== undefined ) {
            console.log("Agent search with store "+req.query.store)
            filters.storeName=req.query.store;
        }
            /*
    console.log("agentScreenShot "+JSON.stringify(filters));
    console.log(JSON.stringify({ retailer_id: req.cookies["retailerId"], ...filters}));
    // console.log(filters);

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
            console.log(result);
            res.send(result[0])
        }
        */
        var agents = azureClient.db("pas_software_distribution").collection("agents");
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
                console.log("sending agentList : ", agentList)
                res.status(statusCode.OK).json(agentList);
                //res.send(agentList[0])
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

        const deployQuery = { retailer_id: req.cookies["retailerId"], storeName: storeName, id: parseInt(id), status: { $in: ["initial", "Initial", "Pending", "pending"] } };
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

    app.get('/REMS/store-list', (req, res) => {
        var results = []

        console.log(JSON.stringify({ retailer_id: req.cookies["retailerId"]}));

        var storeList = azureClient.db("pas_software_distribution").collection("store-list");
        
        storeList.find({ retailer_id: req.cookies["retailerId"]}).toArray(function (err, result) {
            
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
                console.log(results);
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
        // console.log(filters);

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
                console.log(result);
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
        // console.log(filters);

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
                console.log(results);
                res.send(results)
            }

        });
    });

    app.post('/REMS/save-store-data', bodyParser.json(), (req, res) => {
        console.log("New command set");
        console.log(JSON.stringify(req.body));

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
    
                console.log("Updated");
    

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
                
                console.log(JSON.stringify(toInsert));
    
                deployConfig.insertOne(toInsert, function (err, res) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    }
                });
    
                console.log("Inserted");
    
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
}