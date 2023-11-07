const mongodb = require("mongodb")
var bodyParser = require('body-parser');
const _ = require('lodash');
const { InsertAuditEntry } = require("../middleware/auditLogger");
const statusCode = require('http-status-codes').StatusCodes

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {

    app.post('/retailers/insertTenant', bodyParser.json(), (req, res) => {
        console.log('/retailer/insertTenant with: ', req.body)
        let updateWasGood = true
        var retailers = azureClient.db("pas_software_distribution").collection("retailers");
        var users = azureClient.db("pas_config").collection("user")
        retailers.findOne({ retailer_id: req.body["retailer_id"] }).then((result) => {
            if (result !== null) {
                const msg = { "error": 'Tenant/Retailer already exists!' }
                updateWasGood = false
                res.status(statusCode.CONFLICT).json(msg)
                res.send()
            } else {
                var newTenantToInsert = {
                    retailer_id: req.body.retailer_id,
                    description: req.body?.description,
                    configuration: [],
                    isTenant: true
                }

                retailers.insertOne(newTenantToInsert, function (err, result) {
                    if (err) {
                        const msg = { "error": err }
                        updateWasGood = false
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    } else {
                        InsertAuditEntry('insert', null, newTenantToInsert, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'retailers' })
                    }
                })

                let parentTenants = []
                retailers.find({ retailer_id: req.body.parentRemsServerId }).toArray((err, result) => {
                    if (result[0]?.tenants?.length > 0) {
                        parentTenants = result[0]?.tenants
                    } else {
                        // REMS server was previously not tenantized
                        // We need to assign all users who previously had this
                        // Retailer ID to the new (and first) tenant
                        retailers.find({ retailer_id: req.body.parentRemsServerId }).toArray((err, result) => {
                            users.find({ retailer: result[0].description }).forEach(function (userResult) {
                                userResult.retailer = _.remove(userResult.retailer, function (x) {
                                    return x !== result[0].description
                                })
                                userResult.retailer.push(req.body["description"])
                                users.findOneAndUpdate({ _id: userResult._id }, { "$set": userResult }, { upsert: true }, function (err, result) {
                                    if (result.value !== null) {
                                        InsertAuditEntry('update', result.value, userResult, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_config', collection: 'user' })
                                    }
                                    if (err) {
                                        const msg = { "error": err }
                                        throw err;
                                    }
                                })
                            })
                        })

                    }
                    parentTenants.push({
                        retailer_id: req.body.retailer_id,
                        description: req.body.description
                    })
                    retailers.findOneAndUpdate({ retailer_id: req.body.parentRemsServerId }, { $set: { tenants: parentTenants, isTenantRemsServer: true } }, (err, result) => {
                        if (err) {
                            console.log("Update error : ", err)
                            const msg = { "message": "Error updating retailer" }
                            updateWasGood = false
                            res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                            throw (err)
                        }
                        if (result) {
                            InsertAuditEntry('update', result.value, { $set: { tenants: parentTenants, isTenantRemsServer: true } }, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'retailers' })
                        }
                        if (updateWasGood) {
                            res.status(statusCode.OK).json({ "message": "SUCCESS" });
                            return
                        }
                    })

                })
            }
        })
    })

    app.get('/retailers/retrieveTenantParentAndDescription', (req, res) => {
        var retailers = azureClient.db("pas_software_distribution").collection("retailers");
        retailers.find({ isTenantRemsServer: true }, {}).toArray(function (err, retailerList) {
            if (err) {
                const msg = { "error": err };
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw err;
            } else if (!retailerList) {
                const msg = { "message": "Agents: Error reading from server" };
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                var desiredRetailer = ''
                retailerList.forEach(retailer => {
                    retailer.tenants.forEach(tenant => {
                        if (tenant.retailer_id === req.query["retailerId"]) {
                            desiredRetailer = {
                                retailer_id: retailer.retailer_id,
                                tenant_id: tenant.retailer_id,
                                description: tenant.description
                            }
                        }
                    });
                });
                if (desiredRetailer !== '') {
                    res.status(statusCode.OK).json(desiredRetailer)
                } else {
                    const msg = { "message": "Could not find desired retailer" }
                    res.status(statusCode.NO_CONTENT).json(msg)
                }

            }
        });
    });

    app.get('/retailers/getRemsStoreInfo', async (req, res) => {
        var retailers = azureClient.db("pas_software_distribution").collection("retailers");
        var stores = azureClient.db("pas_software_distribution").collection("stores");
        var selectedRetailer = await retailers.findOne({ retailer_id: req.query["retailerId"] })
        if (selectedRetailer?.isTenant === true) {
            // is tenant
            var parentRemsServer = await retailers.findOne({ tenants: { $elemMatch: { retailer_id: req.query["retailerId"] } } })
            var remsServerStores = []
            stores.find({ retailer_id: parentRemsServer.retailer_id }).forEach(function (result) {
                result.id = result._id
                remsServerStores.push(result)
            }).then(() => {
                res.status(statusCode.OK).json({
                    remsInfo: parentRemsServer,
                    stores: remsServerStores
                })
            })
        } else {
            // is not tenant
            var remsServer = await retailers.findOne({ retailer_id: req.query["retailerId"] })
            var remsServerStores = []
            stores.find({ retailer_id: req.query["retailerId"] }).forEach(function (result) {
                result.id = result._id
                remsServerStores.push(result)
            }).then(() => {
                res.status(statusCode.OK).json({
                    remsInfo: remsServer,
                    stores: remsServerStores
                })
            })
        }
    });

    app.delete('/retailers/deleteTenant', async (req, res) => {
        console.log("/retailers/deleteTenant received with: ", req.query)
        const retailers = azureClient.db("pas_software_distribution").collection("retailers")
        const stores = azureClient.db('pas_software_distribution').collection("stores")
        const users = azureClient.db('pas_config').collection('user')

        // First, handle removing tenant from all stores
        stores.find({ tenant_id: req.query["tenantRetailerId"] }).forEach(function (result) {
            if (!result) {
                const msg = { "message": "Tenant: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                stores.findOneAndUpdate({ retailer_id: result.retailer_id, tenant_id: result.tenant_id, storeName: result.storeName }, { $set: { tenant_id: '' } }, function (err, updateResult) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err
                    } else if (!updateResult) {
                        const msg = { "message": "Store: Error reading from server" }
                        res.status(statusCode.NO_CONTENT).json(msg);
                    } else {
                        InsertAuditEntry('update', updateResult.value, { $set: { tenant_id: '' } }, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'stores' })
                    }
                })
            }
        })

        // Finally, remove the tenant from the Parent REMS server entry
        retailers.findOne({ "tenants": { $elemMatch: { retailer_id: req.query["tenantRetailerId"] } } }, function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                const msg = { "message": "Retailer: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                if (_.size(result.tenants) > 1) {
                    _.remove(result.tenants, x => x.retailer_id === req.query["tenantRetailerId"])
                } else {
                    // we gotta help all those poor, de-tenantized users out now
                    retailers.findOne({ retailer_id: req.query["tenantRetailerId"] }, function (err, tenantResult) {
                        users.find({ retailer: tenantResult.description }).forEach(function (userResult) {
                            userResult.retailer = _.remove(userResult.retailer, function (x) {
                                return x !== tenantResult.description
                            })
                            userResult.retailer.push(result.description)
                            users.findOneAndUpdate({ _id: userResult._id }, { "$set": userResult }, { upsert: true }, function (err, result) {
                                if (result.value !== null) {
                                    InsertAuditEntry('update', result.value, userResult, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_config', collection: 'user' })
                                }
                                if (err) {
                                    const msg = { "error": err }
                                    throw err;
                                }
                            })
                        })
                    })
                    // this was the last tenant on the REMS server
                    result.tenants = []
                    // Then handle deleting the retailer entry for the tenant
                    retailers.findOneAndDelete({ retailer_id: req.query["tenantRetailerId"] }, function (err, result) {
                        if (err) {
                            const msg = { "error": err }
                            res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                            throw err
                        } else if (!result) {
                            const msg = { "message": "Tenant: Error reading from server" }
                            res.status(statusCode.NO_CONTENT).json(msg);
                        } else {
                            InsertAuditEntry('delete', result.value, 'delete', req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'retailers' })
                        }
                    })
                }

                let retailerUpdate = { $set: { tenants: result.tenants } }
                if (_.size(result.tenants) <= 0) {
                    retailerUpdate = { $set: { tenants: [], isTenantRemsServer: false, configuration: {} } }
                }
                retailers.findOneAndUpdate({ "retailer_id": result.retailer_id }, retailerUpdate, function (error, updateResult) {
                    if (error) {
                        console.log("Update error : ", error)
                        const msg = { "message": "Error updating retailer" }
                        response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                        throw (error)
                    }

                    if (updateResult) {
                        InsertAuditEntry('update', updateResult.value, retailerUpdate, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_software_distribution', collection: 'retailers' })
                        res.status(statusCode.ACCEPTED).json(updateResult.value)
                    }
                })
            }
        })
    })

    app.post('/retailers/getSidebarConfiguration', bodyParser.json(), (req, res) => {
        console.log('retailers/getSidebarConfiguration called with: ', req.body)
        const configurations = azureClient.db("pas_config").collection("configurations");
        const retailers = azureClient.db("pas_software_distribution").collection("retailers");
        let query = { configType: 'retailer' }

        configurations.find(query).toArray(function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                const msg = { "message": "Config: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                const configurationData = result
                retailers.find({ retailer_id: { $in: req.body.data } }).toArray(function (err, retailerResult) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err
                    } else if (!result) {
                        const msg = { "message": "Config: Error reading from server" }
                        res.status(statusCode.NO_CONTENT).json(msg);
                    } else {
                        const configurationResponse = {}
                        const retailer_filters = { ...retailerResult?.[0]?.configuration };
                        retailerResult.forEach((item) => {
                            for (let key in item.configuration) {
                                const value = item.configuration[key];
                                if (value === true || value === 'true') {
                                    retailer_filters[key] = true;
                                }
                            }
                        });
                        const retailer = { configuration: retailer_filters }
                        configurationData.forEach((config, index) => {
                            if (_.has(retailer.configuration, config.configName)) {
                                // add to response
                                let tempObj = {
                                    configName: config.configName,
                                    configValue: retailer.configuration[config.configName],
                                    configValueType: config.configValueType,
                                    configDisplay: config.configDisplay,
                                    configCategory: config.configCategory
                                }
                                _.set(configurationResponse, ['configuration', [index], config.configName], tempObj)
                            } else {
                                // add default to response
                                let tempObj = {
                                    configName: config.configName,
                                    configValue: config.configDefaultValue,
                                    configValueType: config.configValueType,
                                    configDisplay: config.configDisplay,
                                    configCategory: config.configCategory
                                }
                                _.set(configurationResponse, ['configuration', [index], config.configName], tempObj)
                            }
                        });
                        res.status(statusCode.OK).json(configurationResponse);
                    }
                })
            }
        })
    });

    app.get('/retailers/getConfiguration', (req, res) => {
        console.log('retailers/getConfiguration called with: ', req.query)
        const configurations = azureClient.db("pas_config").collection("configurations");
        const retailers = azureClient.db("pas_software_distribution").collection("retailers");
        let query = null
        if (req.query.isAdmin === 'true') {
            query = { configType: 'retailer' }
        } else if (req.query.ccv === 'true') {
            query = { configType: 'retailer', toshibaOnly: false }
        } else {
            query = { configType: 'retailer', toshibaOnly: false, commandCenterOnly: false }
        }

        configurations.find(query).toArray(function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                const msg = { "message": "Config: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                const configurationData = result

                let retailerId = ''
                if (req.query?.retailerId !== undefined) {
                    retailerId = req.query?.retailerId
                } else {
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json('Somehow no retailer id sent')
                }
                retailers.find({ retailer_id: retailerId }, {}).toArray(function (err, retailerResult) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err
                    } else if (!result) {
                        const msg = { "message": "Config: Error reading from server" }
                        res.status(statusCode.NO_CONTENT).json(msg);
                    }
                    else {
                        const configurationResponse = {}

                        configurationData.forEach((config, index) => {
                            if (_.has(retailerResult[0].configuration, config.configName)) {
                                // add to response
                                let tempObj = {
                                    configName: config.configName,
                                    configValue: retailerResult[0].configuration[config.configName],
                                    configValueType: config.configValueType,
                                    configDisplay: config.configDisplay,
                                    configCategory: config.configCategory
                                }
                                _.set(configurationResponse, ['configuration', [index], config.configName], tempObj)
                            } else {
                                // add default to response
                                let tempObj = {
                                    configName: config.configName,
                                    configValue: config.configDefaultValue,
                                    configValueType: config.configValueType,
                                    configDisplay: config.configDisplay,
                                    configCategory: config.configCategory
                                }
                                _.set(configurationResponse, ['configuration', [index], config.configName], tempObj)
                            }
                        });
                        // console.log("Found retailer config data: ", retailerResult[0])
                        res.status(statusCode.OK).json(configurationResponse);
                    }
                })
            }
        })
    });

    app.get('/retailers/getAllDetails', (req, res) => {
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
}