const mongodb = require("mongodb")
const _ = require('lodash');
const { InsertAuditEntry } = require("../middleware/auditLogger");
const statusCode = require('http-status-codes').StatusCodes
var bodyParser = require('body-parser');

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.get('/stores/info', (req, res) => {
        console.log("Get /stores/info received : ", req.query)

        const stores = azureClient.db("pas_software_distribution").collection("stores");
        stores.find({ retailer_id: req.query["retailerId"], storeName: req.query["storeName"] }, {}).toArray(function (err, rems) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!rems) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                // console.log("sending store info : ", rems)
                res.status(statusCode.OK).json(rems);
            }
        });
    });

    app.get('/stores/getForRetailer', (req, res) => {
        console.log("Get /stores/getForRetailer called with: ", req.query)
        let filters = {}

        const agents = azureClient.db("pas_software_distribution").collection("stores");
        const retailers = azureClient.db("pas_software_distribution").collection("retailers");
        if (req.query["isTenant"] === 'false') {
            agents.find({ retailer_id: req.query["retailerId"], ...filters }, {}).toArray(function (err, agentList) {
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
        } else if (req.query["tenantId"] !== undefined) {
            agents.find({ retailer_id: req.query["retailerId"], tenant_id: req.query["tenantId"], ...filters }, {}).toArray(function (err, agentList) {
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
        } else {
            retailers.find({ isTenantRemsServer: true }).toArray(function (err, tenantList) {
                if (err) {
                    const msg = { "error": err }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err
                } else if (!tenantList) {
                    const msg = { "message": "Tenants: Error reading from server" }
                    res.status(statusCode.NO_CONTENT).json(msg)
                } else {
                    tenantList.forEach(tenantBearingRemsServer => {
                        tenantBearingRemsServer.tenants.forEach(tenant => {
                            if (tenant.retailer_id === req.query["retailerId"]) {
                                agents.find({ retailer_id: tenantBearingRemsServer.retailer_id, tenant_id: tenant.retailer_id }).toArray(function (err, agentList) {
                                    if (err) {
                                        const msg = { "error": err }
                                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                                        throw err
                                    } else if (!agentList) {
                                        const msg = { "message": "Agents: Error reading from server" }
                                        res.status(statusCode.NO_CONTENT).json(msg);
                                    }
                                    else {
                                        res.status(statusCode.OK).json(agentList)
                                    }
                                })
                            }
                        })
                    })
                }
            })
        }
    });

    app.post('/stores/updateTenantAssignment', bodyParser.json(), (req, res) => {
        console.log('/stores/updateTenantAssignment received with: ', req.body)
        const stores = azureClient.db("pas_software_distribution").collection("stores")
        let updateWasGood = true
        stores.findOneAndUpdate({ retailer_id: req.body["retailer"], storeName: req.body["store"] }, { $set: { tenant_id: req.body["newTenant"] } }, (err, result) => {
            if (err) {
                console.log("Update error : ", err)
                const msg = { "message": "Error updating store tenant" }
                updateWasGood = false
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw (err)
            }
            if (result) {
                InsertAuditEntry('update', result.value, { $set: { tenant_id: req.body["newTenant"] } }, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'stores' })
            }
            if (updateWasGood) {
                res.status(statusCode.OK).json({ "message": "SUCCESS" });
                return
            }

        })
    })

    app.post('/stores/bulkUpdateTenantAssignments', bodyParser.json(), (req, res) => {
        console.log('/stores/bulkUpdateTenantAssignment received with: ', req.body)
        const stores = azureClient.db("pas_software_distribution").collection("stores")
        let updateWasGood = true
        req.body.updates.forEach(row => {
            stores.findOneAndUpdate({ storeName: row.store, retailer_id: req.body.rems }, { $set: { tenant_id: row.tenant } }, (err, result) => {
                if (err) {
                    console.log("Update error : ", err)
                    const msg = { "message": "Error updating store tenant" }
                    updateWasGood = false
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                    throw (err)
                }
                if (result) {
                    InsertAuditEntry('update', result.value, { $set: { tenant_id: row.tenant } }, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'stores' })
                }
            })
        });
        if (updateWasGood) {
            res.status(statusCode.OK).json({ "message": "SUCCESS" });
            return
        }
    })

    app.get('/stores/getAll', (req, res) => {
        console.log("Get /stores/getAll received : ", req.query)

        const stores = azureClient.db("pas_software_distribution").collection("stores");
        stores.find().toArray(function (err, storeList) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!storeList) {
                const msg = { "message": "Stores: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                // console.log("sending storeList : ", storeList)
                res.status(statusCode.OK).json(storeList);
            }
        });
    });

    app.delete("/stores/delete", bodyParser.json(), async (req, res) => {
        console.log("/stores/delete received with: ", req.query)
        const store = req.query?.store;
        const retailer = req.query?.retailer_id

        if (!store) {
            res.status(400).send({ error: "Bad request, store is missing." });
            return;
        }

        var stores = azureClient.db("pas_software_distribution").collection("stores");
        var agents = azureClient.db("pas_software_distribution").collection("agents");

        try {
            const result = await stores.findOneAndDelete({ storeName: store, retailer_id: retailer });
            const agentsDeleteResult = await agents.deleteMany({ storeName: store, retailer_id: retailer })

            if (result.value !== null && agentsDeleteResult.value !== null) {
                InsertAuditEntry('delete', result.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'stores' })
                InsertAuditEntry('delete', agentsDeleteResult.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'agents' })
                res.status(200).send({ message: "Store successfully deleted from the database." });
            } else {
                res.status(404).send({ error: "Store not found in the database." });
            }
        } catch (error) {
            res.status(500).send({ error: "An error occurred when trying to delete the store from the database." });
            console.error(error);
        }
    });
}