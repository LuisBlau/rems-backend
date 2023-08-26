const mongodb = require("mongodb")
var bodyParser = require('body-parser');
const _ = require('lodash');
const statusCode = require('http-status-codes').StatusCodes

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {

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
                        retailerResult.forEach(retailer => {
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
                        });
                        // console.log("Found retailer config data: ", retailerResult[0])
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
}