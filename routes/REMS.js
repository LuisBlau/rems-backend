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

// setup dirs
var uploadDir = process.env.REMS_HOME + "/uploads";

/* cSpell:disable */
//setup azure connections
var azureClient = new require("mongodb").MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();
/* cSpell:enable */

//find retailer id
readRetailerId();

function readRetailerId() {
    const fileStream = fs.createReadStream(process.env.REMS_HOME + "/etc/com.toshibacommerce.service.cloudforwarder.cfg");

    const lineReader = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    lineReader.on('line', function (line) {
        if (line.includes("retailer-torico-id")) {
            var values = line.split("=");
            global.retailerId = values[1];
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
async function lookupAgents(stores) {

    if (stores.length > 0) {
        const promises = stores.map(async store => {
            const agents = azureClient.db("pas_software_distribution").collection("store-list");
            try {
                const response = await agents.findOne({
                    retailer_id: retailerId,
                    list_name: store.name
                })
                return {
                    index: store.index,
                    storeName: store.name,
                    agentName: (!response) ? null : response.agents.join()
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
        var form = new multiparty.Form();
        var filename;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('received upload:\n\n');
        form.parse(req, function (err, fields, files) {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir);
            }
            filename = files["file"][0].originalFilename;
            //query biggest index
            var uploads = azureClient.db("pas_software_distribution").collection("uploads");
            var results = [];
            uploads.find({ retailer_id: retailerId }).sort({ id: -1 }).limit(1).toArray(function (err, result) {
                results = result;
                var index = 0;

                if (results.length > 0) {
                    index = results[0].id;
                }
                index++;
                console.log("New index " + index);
                var currentdate = new Date();
                var datetime = currentdate.getFullYear() + "-"
                    + ((currentdate.getMonth() + 1 < 10) ? "0" : "") + (currentdate.getMonth() + 1) + "-"
                    + ((currentdate.getDate() < 10) ? "0" : "") + currentdate.getDate() + " "
                    + ((currentdate.getHours() < 10) ? "0" : "") + currentdate.getHours() + ":"
                    + ((currentdate.getMinutes() < 10) ? "0" : "") + currentdate.getMinutes() + ":"
                    + ((currentdate.getSeconds() < 10) ? "0" : "") + currentdate.getSeconds();


                let newFileName = uploadDir + "/" + index.toString() + ".upload"
                fs.copyFile(files["file"][0].path, newFileName, (err) => {
                    if (err) throw err;
                });

                var newFile = { id: index, retailer_id: retailerId, filename: filename, inserted: currentdate.getTime(), timestamp: datetime, archived: "false", description: fields["description"][0] };
                uploads.insertOne(newFile, function (err, res) {
                    if (err) throw err;
                });

            });
            res.send()
        });

    });

    app.get('/REMS/uploads', (req, res) => {
        var results = []
        var uploads = azureClient.db("pas_software_distribution").collection("uploads");
        uploads.find({ retailer_id: retailerId }).toArray(function (err, result) {
            results = result;
            console.log(result)

            res.send(results)
        });
    });

    app.post('/sendCommand', bodyParser.json(), (req, res) => {
        console.log("New command set");
        console.log(JSON.stringify(req.body))

        //query biggest index
        var deployConfig = azureClient.db("pas_software_distribution").collection("deploy-config");
        var results = [];
        console.log("retailer:"+retailerId+" name:"+req.body.name)

        deployConfig.find({ retailer_id: retailerId, name:req.body.name }).toArray(function (err_find2, result2) {
            if (err_find2) {
                const msg = { "error": err_find2 }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                //throw err_find2
                return
            }
             if ( result2.length > 0 ) {
                const msg = { "message": "Duplicate" }
                res.status(statusCode.OK).json(msg);
                return
            }
        })
            deployConfig.find({ retailer_id: retailerId }).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {

                if (err_find) {
                    const msg = { "error": err_find }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err_find
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

                for (var i = 0; i < req.body.steps.length; i++) {
                    console.log("Step " + i + " type=" + req.body.steps[i].type)
                    toInsert.steps.push({
                        type: req.body.steps[i].type,
                        ...req.body.steps[i].arguments
                    })
                }
                console.log(JSON.stringify(toInsert));

                deployConfig.insertOne(toInsert, function (err, res) {
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
        deploys.find({ retailer_id: retailerId, ...filters }).sort({ id: -1}).limit(maxRecords).toArray(function (err, result) {
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
        configs.find({ retailer_id: retailerId, name: { $ne: "Missing name" } }).toArray(function (err, result) {
            results = result;
            res.send(results);
        });
    });

    app.post('/deploy-schedule', bodyParser.json(), (req, res) => {
        console.log("POST deploy-schedule received : ", req.body)

        const dateTime = req.body["dateTime"];
        const name = req.body.name
        const id = req.body.id
        let storeList = req.body.storeList

        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.findOne({ retailer_id: retailerId, name: name, id: id }, function (err, config) {

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

                    lookupAgents(missingAgent).then(agents => {
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

    app.get('/REMS/agents', (req, res) => {
        console.log("Get /REMS/agents received : ", req.query)
        var results = [];
        let filters = {}

        if (req.query.onlyMasters == 'true') {
            console.log("onlyMasters : ", req.query.onlyMasters)
            filters.is_master = true
        }
        const agents = azureClient.db("pas_software_distribution").collection("agents");
        agents.find({ retailer_id: retailerId, ...filters }, {
            projection: { retailer_id: true, storeName: true, agentName: true, _id: false }
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
                console.log("sending agentList : ", agentList)
                res.status(statusCode.OK).json(agentList);
            }
        });
    });

    app.get('/REMS/stores', (req, res) => {
        console.log("Get /REMS/stores received : ", req.query)
        var results = [];
        let filters = {}

        const agents = azureClient.db("pas_software_distribution").collection("stores");
        agents.find({ retailer_id: retailerId, ...filters }, {}).toArray(function (err, agentList) {
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
            }
        });
    });

    app.post('/deploy-cancel', bodyParser.json(), (request, response) => {
        console.log("POST deploy-update received : ", request.body)
        const storeName = request.body.storeName;
        const id = request.body.id;
        const newStatus = "Cancel";

        const deployQuery = { retailer_id: retailerId, storeName: storeName, id: parseInt(id), status: { $in: ["initial", "Initial", "Pending", "pending"] } };
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

        console.log(JSON.stringify({ retailer_id: retailerId}));

        var storeList = azureClient.db("pas_software_distribution").collection("store-list");
        
        storeList.find({ retailer_id: retailerId}).toArray(function (err, result) {
            
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

    app.get('/REMS/specific-store-agent-names', (req, res) => {
        var results = []
        let filters = {}
        var maxRecords = 0;
        if (req.query.storeId) filters.id = req.query.storeId;

        console.log(JSON.stringify({ retailer_id: retailerId, ...filters}));
        // console.log(filters);

        var deploys = azureClient.db("pas_software_distribution").collection("store-list");
        
        deploys.find({ retailer_id: retailerId, ...filters}).toArray(function (err, result) {
            
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
        deployConfig.find({ retailer_id: retailerId, ...filter }).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {

            if (err_find) {
                const msg = { "error": err_find }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err_find
            }

            if(req.body.id) {

                const storeListUpdateQuery = { retailer_id: retailerId, list_name: req.body.list_name, id: req.body.id };
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
                    retailer_id: retailerId,
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
}

