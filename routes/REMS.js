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
var { ObjectId } = require('mongodb')
const { BlobServiceClient } = require('@azure/storage-blob');
const extract = require('extract-zip')
var jwt = require('jsonwebtoken');
const { v1: uuidv1 } = require('uuid');
const { InsertAuditEntry } = require('../middleware/auditLogger');
const { ServiceBusClient } = require("@azure/service-bus");

require('dotenv').config()
const sbClient = new ServiceBusClient("Endpoint=sb://remscomm.servicebus.windows.net/;SharedAccessKeyName=dashboard-express;SharedAccessKey=v8rJ+T/HqTWa3OoWBvGlnWEBjyMBD0+7V+ASbL/Wluw=");

// setup dirs
var uploadDir = process.cwd() + "/uploads";

/* cSpell:disable */
//setup azure connections
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();
/* cSpell:enable */

function sendRelevantJSON(res, jsonPath) {
    res.send(JSON.parse(
        readFileSync(
            path.join(process.cwd(), 'Data', jsonPath)
        )
    ))
}

function deepEqual(x, y) {
    return (x && y && typeof x === 'object' && typeof y === 'object') ?
        (Object.keys(x).length === Object.keys(y).length) &&
        Object.keys(x).reduce(function (isEqual, key) {
            return isEqual && deepEqual(x[key], y[key]);
        }, true) : (x === y);
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

    app.delete("/REMS/deletefile", bodyParser.json(), async (req, res) => {
        console.log("Delete params received : ", req.body, req.query)

        const retailerId = req.body?.retailerId;
        const id = req.body?.id;

        // Make sure id and retailerId are valid
        if (!id || !retailerId) {
            res.status(400).send({ error: "Bad request. id or retailerId is missing." });
            return;
        }

        // Assuming the 'uploads' collection is where your file data is stored
        const uploads = azureClient.db("pas_software_distribution").collection("uploads");

        // Delete the document from MongoDB where retailer_id and id match
        try {
            uploads.findOneAndDelete({ retailer_id: retailerId, id: id }, function (err, result) {
                InsertAuditEntry('delete', result.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'uploads' })
                if (result) {
                    res.status(200).send({ message: "Document successfully deleted from the database." });
                } else {
                    res.status(404).send({ error: "Document not found in the database." });
                }
            });
        } catch (error) {
            res.status(500).send({ error: "An error occurred when trying to delete the document from the database." });
            console.error(error);
        }
    });

    app.post("/REMS/uploadfile", async (req, res) => {
        const retailerId = req.query["retailerId"]
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
            let copyDestination = uploadDir + "/" + filename//index.toString() + ".upload"
            // copies file from appdata directory 
            // (temp clone of uploaded file) to newFileName directory 
            // as copyDestination
            fs.copyFileSync(files["file"][0].path, copyDestination);

            if (allowedExtensions.includes(fileExtension)) {
                await extractZip(copyDestination, targetDirectory);

                // 4690 product file pattern
                let fileNamePattern = /^ADXC.*T{1}.*D{1}.DAT$/;
                var extractfiles = fs.readdirSync(targetDirectory);
                extractfiles.forEach(extractFile => {
                    if (path.extname(extractFile) == ".DAT" && fileNamePattern.test(extractFile)) {
                        const syncData = fs.readFileSync(targetDirectory + '/' + extractFile, { encoding: 'utf8', flag: 'r' });
                        if (syncData.length > 100) {
                            let productName = (((syncData.substring(26, 57)).replace(/ +(?= )/g, '')).replace(/\0.*$/g, '')).replace(/^\s+|\s+$/g, '');
                            let cdNum = syncData.substring(88, 92);
                            let productRelease = syncData.substring(92, 95);

                            const package = { productName: productName, version: cdNum + "-" + productRelease };
                            versionPackages.push(package);
                        }
                    }
                })
            }

            try {
                let query
                // if (req.query["tenantId"] === undefined) {
                query = { retailer_id: retailerId };
                // } else {
                //     query = { retailer_id: retailerId, tenant_id: req.query["tenantId"] }
                // }

                const options = { sort: { "id": -1 } };
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
                    let azureFileName
                    // if (req.query["tenantId"] === undefined) {
                    azureFileName = retailerId + "-" + index.toString() + ".upload";
                    // } else {
                    // azureFileName = req.query["tenantId"] + "-" + index.toString() + ".upload";
                    // }
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
                        console.log((fileSize / 1048576).toFixed(2) + "mb blob was uploaded successfully. requestId: ", uploadBlobResponse.requestId);
                    } catch (error) {
                        console.log("Error occurred while file uploading to Azure");
                        throw error;
                    }
                    let newFile
                    if (req.query["tenantId" === undefined]) {
                        newFile = {
                            id: index,
                            uuid: uuidv1(),
                            retailer_id: retailerId,
                            filename: filename,
                            inserted: currentdate.getTime(),
                            timestamp: datetime,
                            archived: false,
                            description: fields["description"][0],
                            packages: versionPackages
                        };
                    } else {
                        newFile = {
                            id: index,
                            uuid: uuidv1(),
                            retailer_id: retailerId,
                            tenant_id: req.query["tenantId"],
                            filename: filename,
                            inserted: currentdate.getTime(),
                            timestamp: datetime,
                            archived: false,
                            description: fields["description"][0],
                            packages: versionPackages
                        };
                    }


                    // once file is uploaded, make a record in the uploads collection
                    uploads.insertOne(newFile);
                    InsertAuditEntry('insert', null, newFile, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'uploads' })

                    res.writeHead(200, { 'content-type': 'text/plain' });
                    res.write('received upload:\n\n');
                    res.send()
                })

            } catch (ex) {
                res.writeHead(500, { 'content-type': 'text/plain' });
                res.write('upload error');
                res.send()
                console.log(ex.message);
                throw ex;
            };
        });
    });

    app.get('/REMS/uploads', (req, res) => {
        let query = { retailer_id: req.query.retailerId }
        if (req.query["tenantId"] !== undefined) {
            query.tenant_id = req.query["tenantId"]
        }
        var allUploads = []

        if (!(req.query?.archived)) query["archived"] = { $in: ['false', false] }
        var uploads = azureClient.db("pas_software_distribution").collection("uploads");
        uploads.find(query).forEach(function (result) {
            allUploads.push(result)
        }).then(() => {
            var uploads = azureClient.db("pas_software_distribution").collection("uploads");
            query = { retailer_id: "COMMON" }
            uploads.find(query).forEach(function (result) {
                allUploads.push(result)
            }).then(() => {
                res.send(allUploads)
            })
        })
    });

    app.get("/REMS/deleteExistingList", (req, res) => {
        azureClient.db("pas_software_distribution").collection("store-list").findOneAndDelete({ "_id": ObjectId(req.query.id) }, function (err, result) {
            InsertAuditEntry('delete', result.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'store-list' })
            res.sendStatus(200)
        })
    })

    app.get("/REMS/getTableauJwt", (req, res) => {
        var retailers = azureClient.db("pas_software_distribution").collection("retailers");
        let username = ''
        retailers.find({ "retailer_id": req.query.retailerId }).toArray(function (err, result) {
            if (result[0]["configuration"]["retailerTableauEmail"]) {
                username = result[0]["configuration"]["retailerTableauEmail"]
            }
        });
        const uuid = uuidv1();
        const timenow = new Date().getTime();
        const expiry = new Date().getTime() + (5 * 60 * 1000);
        let client_id = ''
        let secret_id = ''
        let secret_value = ''

        if (req.query["env"] === 'prod') {
            client_id = process.env.CONNECTED_APP_CLIENT_ID_PROD
            secret_id = process.env.CONNECTED_APP_SECRET_ID_PROD
            secret_value = process.env.CONNECTED_APP_SECRET_VALUE_PROD
        } else if (req.query["env"] === 'staging') {
            client_id = process.env.CONNECTED_APP_CLIENT_ID_STAGING
            secret_id = process.env.CONNECTED_APP_SECRET_ID_STAGING
            secret_value = process.env.CONNECTED_APP_SECRET_VALUE_STAGING
        } else {
            // send error
            // res.send()
        }
        if (username === '') {
            username = 'tgcs_pas_con_apps@toshibagcs.com'
        }

        var token = jwt.sign({
            iss: client_id,
            sub: username,
            aud: "tableau",
            exp: expiry / 1000,
            iat: timenow / 1000,
            jti: uuid,
            scp: ["tableau:views:embed", "tableau:metrics:embed"]
        },
            secret_value,
            {
                algorithm: 'HS256',
                header: {
                    'kid': secret_id,
                    'iss': client_id
                }
            }
        );
        res.send(token);
    })

    app.post('/sendCommand', bodyParser.json(), (req, res) => {
        console.log('/sendCommand with: ', req.query, req.body)
        const retailerId = req.query["retailerId"]
        //query biggest index
        var deployConfig = azureClient.db("pas_software_distribution").collection("deploy-config");
        var filter = { retailer_id: retailerId }
        if (req.query["tenantId"] !== undefined) {
            filter.tenant_id = req.query["tenantId"]
        }
        deployConfig.find(filter).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {

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
                uuid: uuidv1(),
                name: req.body.name,
                retailer_id: retailerId,
                steps: []
            }

            if (req.query.tenantId === 'common' || req.query.retailerId === 'common') {
                toInsert = {
                    id: index,
                    name: req.body.name,
                    retailer_id: retailerId,
                    steps: [],
                    forProd: req.body.forProd
                }
            }

            if (req.query["tenantId"] !== undefined) {
                toInsert.tenant_id = req.query["tenantId"]
            }

            for (var i = 0; i < req.body.steps.length; i++) {
                if (req.body.steps[i].type !== null && req.body.steps[i].type !== undefined) {
                    toInsert.steps.push({
                        type: req.body.steps[i].type,
                        ...req.body.steps[i].arguments
                    })
                }
            }
            if (toInsert.steps.length > 0) {
                if (req.query["tenantId"] === undefined) {
                    deployConfig.findOneAndUpdate({ "name": req.body.name, "retailer_id": retailerId }, { "$set": toInsert }, { upsert: true }, function (err, result) {
                        if (result.value !== null) {
                            InsertAuditEntry('update', result.value, toInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'deploy-config' })
                        } else {
                            InsertAuditEntry('insert', null, toInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'deploy-config' })
                        }
                        if (err) {
                            const msg = { "error": err }
                            // TODO: why is this commented out?
                            //res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                            throw err;
                        }
                    });
                } else {
                    deployConfig.findOneAndUpdate({ "name": req.body.name, "retailer_id": retailerId, "tenant_id": req.query["tenantId"] }, { "$set": toInsert }, { upsert: true }, function (err, result) {
                        if (result.value !== null) {
                            InsertAuditEntry('update', result.value, toInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'deploy-config' })
                        } else {
                            InsertAuditEntry('insert', null, toInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'deploy-config' })
                        }
                        if (err) {
                            const msg = { "error": err }
                            // TODO: why is this commented out?
                            //res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                            throw err;
                        }
                    });
                }
                const msg = { "message": "Success" }
                res.status(statusCode.OK).json(msg);
            } else {
                const msg = { "message": "Must contain one or more step implementations..." }
                res.status(statusCode.BAD_REQUEST).json(msg)
            }
        })
    })

    app.get('/REMS/deploys', (req, res) => {
        console.log('/REMS/deploys with: ', req.query)
        var results = []
        let filters = {}
        var maxRecords = 0;
        if (req.query["tenantId"] !== undefined) {
            filters.tenant_id = req.query["tenantId"]
        }
        if (req.query.store) filters.agentName = { $regex: ".*" + req.query.store + ".*" }
        if (req.query.package) filters.package = req.query.package
        if (req.query.records) maxRecords = parseInt(req.query.records);
        if (req.query.status) filters.status = req.query.status;
        var deploys = azureClient.db("pas_software_distribution").collection("deployments");
        deploys.find({ retailer_id: req.query["retailerId"], ...filters }).sort({ id: -1 }).limit(maxRecords).toArray(function (err, result) {
            results = result;
            res.send(results)
        });
    });

    app.get('/REMS/deploy-configs', (req, res) => {
        console.log('deploy-configs called: ', req.query)
        var results = [];
        var retailer_id = req.query["retailerId"]?.split(',');
        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        if (retailer_id?.length > 0) {
            if (req.query["tenantId"] === undefined) {
                configs.find({ retailer_id: { $in: retailer_id }, name: { $ne: "Missing name" } }).toArray(function (err, result) {
                    results = result;
                    res.send(results);
                });
            } else {
                configs.find({ retailer_id: { $in: retailer_id }, name: { $ne: "Missing name" }, tenant_id: req.query["tenantId"] }).forEach(function (r) {
                    results.push(r)
                }).then(() => {
                    configs.find({ retailer_id: "common", name: { $ne: "Missing name" } }).forEach(function (response) {
                        results.push(response)
                    }).then(() => {
                        res.send(results);
                    });
                })

            }
        } else {
            configs.find({ name: { $ne: "Missing name" } }).toArray(function (err, result) {
                results = result;
                res.send(results);
            });
        }

    });

    app.get('/REMS/delete-deploy-config', (req, res) => {
        var id = req.query.id;
        var filter = { retailer_id: req.query["retailerId"], id: parseInt(id) };
        if (req.query["tenantId"] !== undefined) {
            filter.tenant_id = req.query["tenantId"]
        }
        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        configs.findOneAndDelete(filter, function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                return;
            } else {
                const msg = { "message": "Deploy-Config deleted successfully" }
                InsertAuditEntry('delete', result.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'deploy-config' })
                res.status(statusCode.OK).json(msg);
                return;
            }
        });
    });

    app.get("/REMS/setArchive", (req, res) => {
        azureClient.db("pas_software_distribution").collection("uploads").findOneAndUpdate({ "uuid": req.query.uuid }, { "$set": { "archived": (req.query.archived) } }, function (err, result) {
            InsertAuditEntry('update', result.value, { "$set": { "archived": (req.query.archived) } }, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'uploads' })
            res.sendStatus(200)
        })
    });

    app.get("/REMS/setForProd", (req, res) => {
        azureClient.db("pas_software_distribution").collection("uploads").findOneAndUpdate({ "uuid": req.query.uuid }, { "$set": { "forProd": (req.query.forProd) } }, function (err, result) {
            InsertAuditEntry('update', result.value, { "$set": { "forProd": (req.query.forProd) } }, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'uploads' })
            res.sendStatus(200)
        })
    });

    app.get("/REMS/getAttendedLanes", (req, res) => {
        console.log('getAttendedLanes called with: ', req.query)
        let agents = azureClient.db("pas_software_distribution").collection("agents")
        let query = {}
        if (req.query["tenantId"] === undefined) {
            query = { retailer_id: req.query["retailerId"] }
        } else {
            query = { retailer_id: req.query["retailerId"], tenant_id: req.query["tenantId"] }
        }
        agents.find(query).toArray(function (err, results) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                return;
            } else if (results.length < 1) {
                const msg = { "Message": 'No agents found', "Code": 204 }
                res.status(200).json(msg);
                return;
            } else {
                let agentsToSend = []
                results.forEach(agent => {
                    if (agent.os !== 'Android') {
                        if (agent.status) {
                            if (!_.includes(Object.keys(agent.status), "Controller")) {
                                agent.id = agent._id
                                if (agent.isSco === true) {
                                    agent.type = 'SCO'
                                } else {
                                    agent.type = 'Register'
                                }
                                agentsToSend.push(agent)
                            }
                        } else {
                            if (agent.isSco === true) {
                                agent.type = 'SCO'
                            } else[
                                agent.type = 'Register'
                            ]
                            agentsToSend.push(agent)
                        }
                    }
                });
                res.status(200).json(agentsToSend)
            }
        })

    });

    app.get("/REMS/versionsData", async (req, res) => {
        console.log('/REMS/versionsData called with: ', req.query)
        try {
            let data = {
                rem: {},
                agents: [],
            };
            let query = {};
            if (req.query.retailer_id) {
                query["retailer_id"] = req.query.retailer_id;
            }
            let rem = await azureClient
                .db("pas_software_distribution")
                .collection("rems")
                .find(query)
                .toArray();
            if (req.query.tenant_id) {
                query["tenant_id"] = req.query.tenant_id;
            }
            data.rem = rem;
            let agents = await azureClient
                .db("pas_software_distribution")
                .collection("agents")
                .find(query)
                .toArray();
            for (let i = 0; i < agents.length; i++) {
                agents[i]["rma"] = "";
                agents[i]["pas"] = "";
                if (agents[i].versions && agents[i].versions.length > 0) {
                    for (let version of agents[i].versions) {
                        if (RegExp("Remote Management Agent").test(version.Name)) {
                            agents[i]["rma"] = version.Version;
                        } else if (
                            RegExp("Toshiba UnifiedPOS for Windows").test(version.Name)
                        ) {
                            agents[i]["JavaPOS"] = version.Version;
                        } else if (RegExp("Store Integrator").test(version.Name)) {
                            agents[i]["SIGUI"] = version.Version;
                        } else if (
                            RegExp(
                                "Toshiba Checkout Environment for Consumer-Service Lane"
                            ).test(version.Name)
                        ) {
                            agents[i]["CHEC"] = version.Version;
                        }
                    }
                }
                if (agents[i].status && agents[i].status.RMA) {
                    agents[i]["pas"] = agents[i].status.RMA.Version;
                }
            }
            data.agents = agents;

            res.status(200).json(data);
        } catch (e) {
            console.log(e);
            res.status(500).json({ error: e });
        }
    });

    app.get("/REMS/versionCombinations", (req, res) => {
        let query = {}
        if (req.query["tenantId"] === undefined) {
            if (req.query["allRetailers"] === 'false') {
                query.retailer_id = req.query["retailerId"]
            }
        } else {
            if (req.query["allRetailers"] === 'false') {
                query.retailer_id = req.query["retailerId"]
                query.tenant_id = req.query["tenantId"]
            }
        }
        let remsmap = {}
        let versions = []
        let descriptionmap = {}

        azureClient.db("pas_software_distribution").collection("retailers").find(query).forEach(function (retailer) {
            descriptionmap[retailer["retailer_id"]] = retailer["description"]
        }).then(() => {
            azureClient.db("pas_software_distribution").collection("rems").find(query).forEach(function (rems) {
                if (rems["version"]) {
                    // sets the REMS version for the retailer in remsmap
                    remsmap[rems["retailer_id"]] = rems["version"]
                }
            }).then(function () {
                azureClient.db("pas_software_distribution").collection("agents").find(query).forEach(function (agent) {
                    if (!remsmap[agent["retailer_id"]]) {
                        return;
                    }
                    let rems = remsmap[agent["retailer_id"]]
                    let rma = null
                    let cf = "2.1.2"
                    if (!agent["versions"]) return
                    for (var v of agent["versions"]) {
                        // check if the version object has "Name" and "Version" properties
                        if (v["Name"] && v["Version"]) {
                            // look for the Remote Management Agent (RMA) version
                            if (v["Name"].includes("Remote Management Agent")) {
                                let originalVersion = v["Version"]
                                if (originalVersion.startsWith("R")) {
                                    let splitVersion = originalVersion.split('-', [3]);
                                    if (splitVersion.length >= 3) {
                                        let extractedVersion = splitVersion[2].slice(0, 3);
                                        let version = extractedVersion.split('').join('.');
                                        rma = version ? version : null;
                                        break;
                                    }
                                } else {
                                    rma = originalVersion ? originalVersion : null;
                                    break;
                                }
                            }
                        }
                        // check if the version object has "Remote Management Agent" as a key
                        else if (v["Remote Management Agent"]) {
                            let version = v["Remote Management Agent"];
                            rma = version ? version : null;
                            break;
                        }
                    }
                    if (!rma) return
                    versions.push({ "rma": rma, "rems": rems, "cf": cf, "retailer": descriptionmap[agent["retailer_id"]] })
                }).then(function () {
                    let objCount = {}
                    for (var y of versions) {
                        if (!objCount[JSON.stringify(y)]) {
                            objCount[JSON.stringify(y)] = 1
                        } else {
                            objCount[JSON.stringify(y)] = objCount[JSON.stringify(y)] + 1
                        }
                    }
                    let newv = []
                    for (var o of Object.keys(objCount)) {
                        let newobj = JSON.parse(o)
                        newobj["count"] = objCount[o]
                        newv.push(newobj)
                    }
                    res.send(newv)
                })
            })
        })
    });

    app.post('/deploy-schedule', bodyParser.json(), (req, res) => {
        console.log("POST deploy-schedule received : ", req.body, req.query)

        const dateTime = req.body["dateTime"] || null
        const name = req.body.name
        const id = req.body.id
        const deploy = req.body.deploy
        const selected_retailer_id = req.query["retailerId"]
        let storeList = req.body.storeList
        const retailer_id = req.body["retailerId"]
        const tenant_id = req.query["tenantId"]
        const variables = req.body["variables"]
        const configs = azureClient.db("pas_software_distribution").collection("deploy-config");
        let filters = { retailer_id: retailer_id, name: name, uuid: id }

        configs.findOne(filters, function (err, config) {
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
                record.retailer_id = selected_retailer_id;
                record.config_id = config.id
                record.apply_time = dateTime;
                if (req.body["deploy"] === 'immediate') {
                    record.deploy = deploy;
                }
                record.storeName = "";
                record.agentName = "";
                record.status = "Initial";
                record.steps = config.steps;
                record.package = config["name"]
                if (tenant_id !== undefined) {
                    record.tenant_id = tenant_id
                }
                for (const i in record.steps) {
                    for (var v of Object.keys(record.steps[i])) {
                        for (var k of Object.keys(variables)) {
                            record.steps[i][v] = record.steps[i][v].replace(k, variables[k]);
                        }
                    }
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

                    lookupAgents(missingAgent, retailer_id)
                        .then((agents) => {
                            var noAgent = "";
                            if (agents) {
                                agents.map((agent) => {
                                    if (agent.agentName) {
                                        newRecords[agent.index].agentName = agent.agentName;
                                    } else {
                                        noAgent = noAgent + agent.storeName + " ";
                                    }
                                });
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
                                    InsertAuditEntry('insert', null, newRecords, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'deployments' })
                                });

                                //After insert send to bus service if it is immediate
                                if (req.body["deploy"] === 'immediate') {
                                    newRecords.map(rec => {
                                        const msgToSend = {
                                            "body": {
                                                "apply_time": req.body["dateTime"] || null,
                                                "deploy": req.body["deploy"],
                                                "config_id": config.id,
                                                "id": maxId,
                                                "package": req.body["name"],
                                                "retailer_id": req.body["retailerId"],
                                                "storeName": rec.storeName,
                                                "status": "Initial",
                                                "agentName": rec.agentName,
                                                "steps": rec.steps
                                            }
                                        }
                                        const sender = sbClient.createSender(req.query["retailerId"].toLowerCase());
                                        InsertAuditEntry('sendMessage', null, msgToSend, req.cookies.user, { location: 'servicebus', serviceBus: 'remscomm.servicebus.windows.net', sharedAccessKeyName: 'dashboard-express', queue: req.query["retailerId"].toLowerCase() });
                                        sender.sendMessages(msgToSend)
                                    })
                                }
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

    app.get('/REMS/rems', (req, res) => {
        console.log("Get /REMS/rems received : ", req.query)

        const agents = azureClient.db("pas_software_distribution").collection("rems");
        agents.find({ retailer_id: req.query["retailerId"] }, {}).toArray(function (err, rems) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!rems) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                // console.log("sending rems info : ", rems[0])
                res.status(statusCode.OK).json(rems[0]);
            }
        });
    });

    app.get('/REMS/agents', async (req, res) => {
        console.log("Get /REMS/agents received : ", req.query);
        const page = req.query.page ? Number(req.query.page) : 0;
        const limit = req.query.limit ? Number(req.query.limit) : 1000000000;
        const searchText = req.query.searchText;
        const osType = req.query.osType;
        const registerType = req.query.registerType;
        const registerTypeValue = registerType == 'sco' ? true : false;

        const skipValue = page * limit;

        let filters = {}
        let sortBy = {}
        let columnFilter = {}

        if (req.query.tenant) {
            filters.tenant_id = req.query.tenant
        }

        if (registerType) {
            filters.isSco = registerTypeValue;
        }

        if (osType) {
            filters.os = osType;
        }

        if (req.query.agentName) filters.agentName = req.query.agentName;

        if (req.query.onlyMasters == 'true') {
            console.log("onlyMasters : ", req.query.onlyMasters);
            filters.is_master = true;
        }

        if (req.query.store !== undefined) {
            console.log("Agent search with store " + req.query.store);
            filters.storeName = req.query.store;
        }

        if (req.query?.filter) {
            Object.keys(JSON.parse(req.query.filter)).forEach(function eachKey(key) {
                if (JSON.parse(req.query.filter)[key] !== '') {
                    if (key === 'agent') {
                        columnFilter = { ['agentName']: { $regex: new RegExp(JSON.parse(req.query.filter)[key], 'i') } }
                    } else if (key === 'Store') {
                        columnFilter = { ['storeName']: { $regex: new RegExp(JSON.parse(req.query.filter)[key], 'i') } }
                    } else {
                        columnFilter = { [key]: { $regex: new RegExp(JSON.parse(req.query.filter)[key], 'i') } }
                    }
                }
            })
        }

        if (req.query?.sort) {
            Object.keys(JSON.parse(req.query.sort)).forEach(function eachKey(key) {
                if (JSON.parse(req.query.sort)[key] !== '') {
                    if (key === 'agent') {
                        sortBy = { ["agentName"]: JSON.parse(req.query.sort)[key] }
                    } else if (key === 'Store') {
                        sortBy = { ["storeName"]: JSON.parse(req.query.sort)[key] }
                    } else {
                        sortBy = { [key]: JSON.parse(req.query.sort)[key] }
                    }
                }
            })
        }

        var agents = azureClient.db("pas_software_distribution").collection("agents");

        // Building the regex pattern for a 'like' search (case insensitive)
        const searchPattern = new RegExp(searchText, 'i');

        // Assuming 'name' is the field you want to search in
        // Update the 'name' field with the actual field you want to search
        const searchQuery = searchText ? { 'agentName': { $regex: searchPattern } } : {};

        const totalItem = await agents.countDocuments({
            retailer_id: req.query["retailer"],
            ...columnFilter,
            ...filters,
            ...searchQuery
        });

        agents.find({ retailer_id: req.query["retailer"], ...filters, ...columnFilter,...searchQuery }).skip(skipValue).sort(sortBy).limit(limit).toArray(function (err, agentList) {
            if (err) {
                const msg = { "error": err };
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw err;
            } else if (!agentList) {
                const msg = { "message": "Agents: Error reading from server" };
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {

                res.status(statusCode.OK).json({
                    items: agentList,
                    pagination: {
                        limit,
                        page,
                        totalItem,
                        totalPage: Math.ceil(totalItem / limit)
                    }
                })

                // console.log("sending agentList : ", agentList);
                //res.status(statusCode.OK).json(agentList);
            }
        });
    });

    app.get('/REMS/getContainerInformationForStoreAgent', (req, res) => {
        console.log("Get /REMS/getContainerInformationForStoreAgent received : ", req.query);
        if (req.query["tenantId"] === undefined) {
            var agents = azureClient.db("pas_software_distribution").collection("agents")
            agents.findOne({ retailer_id: req.query.retailerId, storeName: req.query.storeName, agentName: req.query.agentName }, function (err, agentDetails) {
                if (err) {
                    const msg = { "error": err };
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                    throw err;
                } else if (!agentDetails) {
                    const msg = { "message": "Agents: Error reading from server" };
                    res.status(statusCode.NO_CONTENT).json(msg);
                }
                else {
                    console.log("sending container info : ", agentDetails.status);
                    res.status(statusCode.OK).json(agentDetails.status);
                }
            });
        } else {
            var agents = azureClient.db("pas_software_distribution").collection("agents");
            agents.findOne({ retailer_id: req.query.retailerId, storeName: req.query.storeName, agentName: req.query.agentName, tenant_id: req.query.tenantId }, function (err, agentList) {
                if (err) {
                    const msg = { "error": err };
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                    throw err;
                } else if (!agentDetails) {
                    const msg = { "message": "Agents: Error reading from server" };
                    res.status(statusCode.NO_CONTENT).json(msg);
                }
                else {
                    console.log("sending container info : ", agentDetails.status);
                    res.status(statusCode.OK).json(agentDetails.status);
                }
            });
        }
    });

    app.get('/REMS/cameraDevicesForStore', (req, res) => {
        var devices = azureClient.db("pas_software_distribution").collection("devices");
        devices.find({ retailer_id: req.query.retailerId, storeName: req.query.storeName, deviceType: { $in: ["ProduceCamera", "LossPreventionCamera"] } }).toArray(function (err, deviceList) {
            if (err) {
                const msg = { "error": err };
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw err;
            } else if (!deviceList || deviceList.length === 0) {
                const msg = { "message": "Devices: No cameras found" };
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                // console.log("sending deviceList : ", deviceList);
                res.status(statusCode.OK).json(deviceList);
            }
        })
    })

    app.get('/REMS/agentsForStore', (req, res) => {
        console.log("Get /REMS/agentsForStore received : ", req.query);
        if (req.query["tenantId"] === undefined) {
            var agents = azureClient.db("pas_software_distribution").collection("agents");
            agents.find({ retailer_id: req.query.retailerId, storeName: req.query.storeName }, {}).toArray(function (err, agentList) {
                if (err) {
                    const msg = { "error": err };
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                    throw err;
                } else if (!agentList || agentList.length === 0) {
                    const msg = { "message": "Agents: No agents found" };
                    res.status(statusCode.NO_CONTENT).json(msg);
                }
                else {
                    // console.log("sending agentList : ", agentList);
                    res.status(statusCode.OK).json(agentList);
                }
            });
        } else {
            var agents = azureClient.db("pas_software_distribution").collection("agents");
            agents.find({ retailer_id: req.query.retailerId, storeName: req.query.storeName, tenant_id: req.query.tenantId }, {}).toArray(function (err, agentList) {
                if (err) {
                    const msg = { "error": err };
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                    throw err;
                } else if (!agentList) {
                    const msg = { "message": "Agents: Error reading from server" };
                    res.status(statusCode.NO_CONTENT).json(msg);
                }
                else {
                    // console.log("sending agentList : ", agentList);
                    res.status(statusCode.OK).json(agentList);
                }
            });
        }
    });

    app.get('/REMS/allAgents', (req, res) => {
        console.log("Get /REMS/allAgents received : ", req.query)

        const retailers = azureClient.db("pas_software_distribution").collection("retailers");
        const agents = azureClient.db("pas_software_distribution").collection("agents");

        retailers.find().toArray(function (err, retailerList) {
            if (err) {
                const msg = { "error": err }
                res.status(500).json(msg);
                throw err;
            } else if (!retailerList) {
                const msg = { "message": "Retailers: Error reading from server" }
                res.status(204).json(msg);
            } else {
                // console.log("Retrieved retailer list");

                let retailerIds = retailerList.map(retailer => retailer.retailer_id);

                agents.find({ retailer_id: { $in: retailerIds } }).toArray(function (err, agentList) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(500).json(msg);
                        throw err;
                    } else if (!agentList) {
                        const msg = { "message": "Agents: Error reading from server" }
                        res.status(204).json(msg);
                    } else {
                        // console.log("Sending agentList : ", agentList);
                        res.status(200).json(agentList);
                    }
                });
            }
        });
    });

    app.post('/REMS/retailerConfigurationUpdate', bodyParser.json(), (request, response) => {
        const retailerId = request.query.retailerId
        const receivedConfigItems = []
        const updatedConfiguration = {}

        const configQuery = { retailer_id: retailerId };
        const configUpdate = { $set: { configuration: updatedConfiguration } }
        // console.log(request.body)
        request.body.forEach(configItem => {
            receivedConfigItems.push(configItem)
        });

        if (receivedConfigItems.length > 0) {
            const retailers = azureClient.db("pas_software_distribution").collection("retailers");
            retailers.find({ retailer_id: retailerId }, {}).toArray(function (err, results) {
                if (err) {
                    const msg = { "error": err }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err
                } else if (!results) {
                    const msg = { "message": "Retailer Configs: Error reading from server" }
                    res.status(statusCode.NO_CONTENT).json(msg);
                } else {
                    let existingConfigurations
                    if (results[0].configuration) {
                        existingConfigurations = results[0].configuration
                    } else {
                        existingConfigurations = {}
                    }
                    let existingConfigNames
                    if (!_.isEmpty(existingConfigurations)) {
                        existingConfigNames = Object.keys(existingConfigurations)
                    } else {
                        existingConfigNames = []
                    }

                    // handle configs that weren't previously stored for this retailer
                    receivedConfigItems.forEach((config, index) => {
                        if (_.find(existingConfigNames, (x) => x === config.configName) === undefined) {
                            _.set(updatedConfiguration, config.configName, receivedConfigItems[index].configValue)
                        }
                    });

                    // handle any updates for stuff that did previously exist
                    if (existingConfigNames.length > 0) {
                        existingConfigNames.forEach(existingConfigItemName => {
                            const receivedIndex = _.findIndex(receivedConfigItems, (x) => x.configName === existingConfigItemName)
                            if (receivedIndex >= 0) {
                                if (receivedConfigItems[receivedIndex].configValueType === 'boolean') {
                                    receivedConfigItems[receivedIndex].configValue = Boolean(receivedConfigItems[receivedIndex].configValue)
                                }
                                _.set(updatedConfiguration, existingConfigItemName, receivedConfigItems[receivedIndex].configValue)
                            }
                        });

                        // add back anything that wasn't sent in (this matters for retailer configs that are set by Toshiba, which the retailer can't see or send)
                        Object.entries(existingConfigurations).forEach(configItem => {
                            const receivedIndex = _.findIndex(receivedConfigItems, (x) => x.configName === configItem[0])
                            if (receivedIndex === -1) {
                                _.set(updatedConfiguration, configItem[0], configItem[1])
                            }
                        });
                    }

                    // DO UPDATE
                    retailers.findOneAndUpdate(configQuery, configUpdate, function (error, updateResult) {
                        if (error) {
                            console.log("Update error : ", error)
                            const msg = { "message": "Error updating retailer configuration" }
                            response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                            throw (error)
                        }

                        if (updateResult) {
                            // const responseInfo =
                            //     " [ Retailer: " + retailerId +
                            //     " configs: " + updateResult +
                            //     " ]";

                            // console.log("Update Retailer Configuration SUCCESS : ", responseInfo)
                            InsertAuditEntry('update', updateResult.value, configUpdate, request.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'retailers' })
                            const msg = { "message": "SUCCESS" }
                            response.status(statusCode.OK).json(msg);
                            return;
                        }
                    })
                }
            })
        }
    });

    app.get('/REMS/toshibaConfiguration', (req, res) => {
        const configurations = azureClient.db("pas_config").collection("configurations");

        configurations.find({ configType: 'toshibaAdmin' }).toArray(function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                const msg = { "message": "Config: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                const configurationData = result
                const configurationResponse = {}

                configurationData.forEach((config, index) => {
                    let tempObj = {
                        configName: config.configName,
                        configValue: config.configDefaultValue,
                        configValueType: config.configValueType,
                        configDisplay: config.configDisplay,
                        configCategory: config.configCategory
                    }
                    _.set(configurationResponse, ['configuration', [index], config.configName], tempObj)
                });
                // console.log("Found admin config data: ", configurationResponse)
                res.status(statusCode.OK).json(configurationResponse);

            }
        })
    });

    app.post('/REMS/toshibaConfigurationUpdate', bodyParser.json(), (request, response) => {
        let updateWasGood = true
        const receivedConfigItems = []

        request.body.forEach(configItem => {
            receivedConfigItems.push(configItem)
        });

        if (receivedConfigItems.length > 0) {
            // For each configuration received, go update them
            receivedConfigItems.forEach(configItem => {
                const configQuery = { configType: 'toshibaAdmin', configName: configItem.configName };
                let configUpdate
                if (configItem.configValueType !== 'boolean') {
                    configUpdate = { $set: { configDefaultValue: configItem.configValue } }
                } else {
                    configUpdate = { $set: { configDefaultValue: Boolean(configItem.configValue) } }
                }

                const configToUpdate = azureClient.db("pas_config").collection("configurations");
                // DO UPDATE
                configToUpdate.findOneAndUpdate(configQuery, configUpdate, function (error, updateResult) {
                    if (error) {
                        console.log("Update error : ", error)
                        const msg = { "message": "Error updating retailer configuration" }
                        updateWasGood = false
                        response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                        throw (error)
                    }

                    if (updateResult) {
                        // const responseInfo =
                        //     " [ ConfigName: " + configItem.configName +
                        //     " Value: " + updateResult +
                        //     " ]";

                        // console.log("Update Toshiba Administrative Configuration SUCCESS : ", responseInfo)
                        InsertAuditEntry('update', updateResult.value, configUpdate, request.cookies.user, { location: 'pas_mongo_database', database: 'pas_config', collection: 'configurations' })
                    }
                })
            });
            if (updateWasGood) {
                response.status(statusCode.OK).json({ "message": "SUCCESS" });
                return
            }
        }
    });

    app.post('/REMS/deploy-cancel', bodyParser.json(), (request, response) => {
        console.log("POST deploy-update received : ", request.body)
        const storeName = request.body.storeName;
        const id = request.body.id;
        const newStatus = "Cancel";

        const deployQuery = { retailer_id: request.query.retailerId, storeName: storeName, id: parseInt(id), status: { $in: ["initial", "Initial", "Pending", "pending"] } };
        const deployUpdate = { $set: { status: newStatus } }
        const deploys = azureClient.db("pas_software_distribution").collection("deployments")
        deploys.findOneAndUpdate(deployQuery, deployUpdate, function (error, upResult) {
            if (error) {
                console.log("Update error : ", error)
                const msg = { "message": "Error Canceling Deployment" }
                response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw (error)
            }

            if (upResult) {
                const responseInfo =
                    " [ store: " + storeName +
                    " id: " + id +
                    " number modified: " + upResult.modifiedCount +
                    " ]"

                if (upResult.modifiedCount <= 0) {
                    console.log("Cancel Deployment Modify FAIL : ", responseInfo)
                    const msg = { "message": "Unable to cancel that Deployment" }
                    response.status(statusCode.NOT_MODIFIED).json(msg);
                    return;
                } else if (upResult.matchedCount <= 0) {
                    console.log('Cancel Deployment did not find a match : ', responseInfo)
                    const msg = { "message": "Unable to find deployment match to cancel" }
                    response.status(statusCode.NOT_MODIFIED).json(msg);
                    return;
                }
                else {
                    // console.log("Cancel Deployment SUCCESS : ", responseInfo)
                    InsertAuditEntry('update', upResult.value, deployUpdate, request.cookies.user, { location: 'pas_mongo_database', database: 'pas_config', collection: 'deployments' })
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
    app.get('/REMS/agent-list', async (req, res) => {
        var results = []
        console.log('agent-list with: ', req.query)

        var storeList = azureClient.db("pas_software_distribution").collection("agent-list");
        let filters = { retailer_id: req.query["retailer"] }
        if (req.query["tenant"] !== undefined) {
            filters.tenant_id = req.query["tenant"]
        }

        storeList.find(filters).toArray(async function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                res.send();
            } else if (!result) {
                const msg = { "message": "No store available for this retailer" }
                res.status(statusCode.NO_CONTENT).json(msg);
                res.send();
            } else {
                const storeListCollection = azureClient.db("pas_software_distribution").collection("store-list");
                const resultsWithAgents = await Promise.all(result.map(async (item) => {
                    try {
                        const agents = await storeListCollection.findOne({ list_name: item.list_name });
                        return { ...item, storeId: agents._id, agents: agents.agents };
                    } catch (err) {
                        return { ...item, storeId: null, agents: [] }; // Return the item with an empty agents array in case of error.
                    }
                }));

                res.send(resultsWithAgents)
            }

        });
    });

    app.get('/REMS/store-list', async (req, res) => {
        var results = []
        console.log('store-list with: ', req.query)

        var storeList = azureClient.db("pas_software_distribution").collection("store-list");
        let filters = { retailer_id: req.query["retailerId"] }
        if (req.query["tenantId"] !== undefined) {
            filters.tenant_id = req.query["tenantId"]
        }
        if (req.query["version"]) {
            var version_split = req.query["version"].split("\n")
            var sw = version_split[0]
            var version = version_split[1]
            var agents = await azureClient.db("pas_software_distribution").collection("agents").find({ "version": { "$elemMatch": { sw: version } } }).toArray()
            filters["agents"] = { "$in": agents }
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
            } else {
                results = result;
                res.send(results)
            }

        });
    });

    app.get('/REMS/agentScreenShot', (req, res) => {
        let filters = {}
        if (req.query.storeName) filters.storeName = req.query.storeName;
        if (req.query.agentName) filters.agentName = req.query.agentName;

        console.log("agentScreenShot " + JSON.stringify(filters));

        var deploys = azureClient.db("pas_software_distribution").collection("agent-screenshot");
        deploys.find({ retailer_id: req.query["retailerId"], ...filters }).toArray(function (err, result) {

            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                res.send();
            } else if (!result) {
                const msg = { "message": "No store available for this retailer" }
                res.status(statusCode.NO_CONTENT).json(msg);
                res.send();
            } else {
                res.send(result[0])
            }

        });
    });
    app.post('/REMS/save-agent-data', bodyParser.json(), async (req, res) => {
        let filters = { retailer_id: req.query["retailerId"] };
        if (req.body.id) filters._id = ObjectId(req.body.id);
        if (req.query["tenantId"] !== undefined) {
            filters.tenant_id = req.query["tenantId"]
        }

        //query biggest index
        var deployConfig = azureClient.db("pas_software_distribution").collection("agent-list");
        let checkDuplicateParams = { list_name: req.body.list_name };
        if (req.body.id) {
            checkDuplicateParams['_id'] = { $ne: ObjectId(req.body.id) };
        }
        const count = await deployConfig.countDocuments(checkDuplicateParams);
        if (count > 0) {
            const msg = { "error": 'List name already exist' };
            res.status(statusCode.UNPROCESSABLE_ENTITY).json(msg);
            return;
        }

        deployConfig.find({ filters, ...filter }).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {
            if (err_find) {
                const msg = { "error": err_find }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err_find
            }

            if (req.body.id) {
                const storeListUpdateQuery = { _id: ObjectId(req.body.id) };
                if (req.query["tenantId"] !== undefined) {
                    storeListUpdateQuery.tenant_id = req.query["tenantId"]
                }
                const storeListUpdateAgent = { $set: { filters: req.body.filters, last_updated: new Date().getTime() } }

                deployConfig.findOneAndUpdate(storeListUpdateQuery, storeListUpdateAgent, function (err, result) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    } else {
                        const msg = { "message": "Success" }
                        InsertAuditEntry('update', result.value, storeListUpdateAgent, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'agent-list' })
                        res.status(statusCode.OK).json(msg);
                    }
                });

            } else {

                var index = 0;
                if (result.length > 0) {
                    index = result[0].id;
                }
                index++;

                var toInsert = {
                    list_name: req.body.list_name,
                    retailer_id: req.query["retailerId"],
                    filters: req.body.filters,
                    last_updated: new Date().getTime()
                }

                if (req.query["tenantId"] !== undefined) {
                    toInsert.tenant_id = req.query["tenantId"]
                }

                deployConfig.insertOne(toInsert, function (err, result) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    } else {
                        InsertAuditEntry('insert', null, toInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'agent-list' })
                        const msg = { "message": "Success" }
                        res.status(statusCode.OK).json(msg);
                    }
                });
            }
        });
    });

    app.post('/REMS/save-store-data', bodyParser.json(), async (req, res) => {
        console.log(req.body)
        let filters = { retailer_id: req.query["retailerId"] };
        if (req.body.id) filters._id = ObjectId(req.body.id);
        if (req.query["tenantId"] !== undefined) {
            filters.tenant_id = req.query["tenantId"]
        }
        //query biggest index
        var deployConfig = azureClient.db("pas_software_distribution").collection("store-list");

        let checkDuplicateParams = { list_name: req.body.list_name };
        if (req.body.id) {
            checkDuplicateParams['_id'] = { $ne: ObjectId(req.body.id) };
        }
        const count = await deployConfig.countDocuments(checkDuplicateParams);
        if (count > 0) {
            const msg = { "error": 'List name already exist' };
            res.status(statusCode.UNPROCESSABLE_ENTITY).json(msg);
            return;
        }
        //Agent List Start
        const searchText = req.body?.filters?.searchText;
        const osType = req.body?.filters?.osType;
        const registerType = req.body?.filters?.registerType;
        const registerTypeValue = registerType == 'sco' ? true : false;
        let filterAgents = {}
        if (registerType) {
            filterAgents.isSco = registerTypeValue;
        }
        if (osType) {
            filterAgents.os = osType;
        }
        var agents = azureClient.db("pas_software_distribution").collection("agents");
        const searchPattern = new RegExp(searchText, 'i');
        const searchQuery = searchText ? { 'agentName': { $regex: searchPattern } } : {};
        const query = { retailer_id: req.query["retailerId"], ...filterAgents, ...searchQuery };
        if (req.query["tenantId"] !== undefined) {
            query['tenant_id'] = req.query["tenantId"];
        }
        console.log({ query })
        const agentsData = await agents.find(
            query,
            { projection: { agentName: 1 } }
        ).toArray();
        const agentNames = agentsData?.map(agent => agent.agentName);
        //Agent List End

        deployConfig.find({ filters, ...filter }).sort({ id: -1 }).limit(1).toArray(function (err_find, result) {

            if (err_find) {
                const msg = { "error": err_find }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err_find
            }

            if (req.body.id) {

                const storeListUpdateQuery = { _id: ObjectId(req.body.id) };
                if (req.query["tenantId"] !== undefined) {
                    storeListUpdateQuery.tenant_id = req.query["tenantId"];
                }
                const storeListUpdateAgent = { $set: { agents: agentNames } }

                deployConfig.findOneAndUpdate(storeListUpdateQuery, storeListUpdateAgent, function (err, result) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    } else {
                        const msg = { "message": "Success" }
                        InsertAuditEntry('update', result.value, storeListUpdateAgent, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'store-list' })
                        res.status(statusCode.OK).json(msg);
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
                    retailer_id: req.query["retailerId"],
                    agents: []
                }

                if (req.query["tenantId"] !== undefined) {
                    toInsert.tenant_id = req.query["tenantId"]
                }

                /*
                    get agents collection from mongo db
                        db.("pas_software_distribution").collection("agents")
                    filter _that_ by the filter criteria
                    store those in your array, push them to the insert

                */
                toInsert.agents = toInsert.agents.concat(agentNames);
                deployConfig.insertOne(toInsert, function (err, result) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    } else {
                        InsertAuditEntry('insert', null, toInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'store-list' })
                        const msg = { "message": "Success" }
                        res.status(statusCode.OK).json(msg);
                    }
                });
            }
        });
    });
    app.get("/REMS/deleteAgentData", (req, res) => {
        azureClient.db("pas_software_distribution").collection("agent-list").findOneAndDelete({ "_id": ObjectId(req.query.id) }, function (err, result) {
            InsertAuditEntry('delete', result.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'agent-list' })
            res.sendStatus(200)
        })
    })

    app.get('/REMS/retailerids', (req, res) => {
        console.log("Get /REMS/rems received : ", req.query)
        const agents = azureClient.db("pas_software_distribution").collection("rems");
        agents.find({}, { projection: { retailer_id: true, _id: false } }).toArray(function (err, rems) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!rems) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                output = rems.map(function (item) { return item.retailer_id; })
                res.status(statusCode.OK).json(output);
            }
        });
    });

    app.get('/REMS/getRetailerDetails', (req, res) => {
        var results = {}
        var retailerDetails = azureClient.db("pas_software_distribution").collection("retailers");
        retailerDetails.find({ retailer_id: req.query.id }).limit(1).toArray(function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            }

            if (result.length > 0) {
                results = result[0];
            }

            res.send(results)
        });
    });

    app.get('/REMS/getAllRetailerDetails', (req, res) => {
        var retailersDetails = azureClient.db("pas_software_distribution").collection("retailers");
        retailersDetails.find().toArray(function (err, result) {
            var retailers = []
            result.forEach(retailerObject => {
                if (retailerObject.isTenantRemsServer !== true && retailerObject.isTenant !== true) {
                    retailers.push(retailerObject)
                } else {
                    if (retailerObject.isTenantRemsServer === true) {
                        retailerObject.tenants.forEach(tenant => {
                            retailers.push(_.find(result, x => x.retailer_id === tenant.retailer_id))
                        });
                    }
                }
            });
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else {
                res.send(retailers)
            }
        });
    });

    app.delete("/REMS/deleteRemsDoc", (req, res) => {
        const idStr = req.query._id; // Assuming the query parameter is named "_id"
        if (!idStr) {
            res
                .status(400)
                .json({ error: "The '_id' query parameter must be provided" });
            return;
        }
        const idObj = new ObjectId(idStr); // Convert to ObjectId
        var remsColl = azureClient
            .db("pas_software_distribution")
            .collection("rems");

        remsColl.findOneAndDelete({ _id: idObj }, function (err, result) {
            if (err) {
                console.error("An error occurred:", err);
                res
                    .status(500)
                    .json({ error: "An error occurred while deleting the document" });
                return;
            }
            if (result && result.value) {
                res.status(200).json({ message: "Document deleted successfully" });
            } else {
                res.status(404).json({ message: "Document not found" });
            }
        });
    });
};
