const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.get('/devices/getDevices', (req, res) => {
        let query = { retailer_id: req.query.retailerId, ip: { $ne: null } }
        if (req.query["tenantId"] !== undefined) {
            query.tenant_id = req.query["tenantId"]
        }

        var devices = azureClient.db("pas_software_distribution").collection("devices");
        devices.find(query).toArray(function (err, results) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
            } else if (results.length === 0) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                res.status(statusCode.OK).json(results);
            }
        })
    });

    app.get('/devices/getPeripherals', (req, res) => {
        let query = { retailer_id: req.query.retailerId, ip: null }
        if (req.query["tenantId"] !== undefined) {
            query.tenant_id = req.query["tenantId"]
        }

        var devices = azureClient.db("pas_software_distribution").collection("devices");
        devices.find(query).toArray(function (err, results) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
            } else if (results.length === 0) {
                const msg = { "message": "Rems: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                res.status(statusCode.OK).json(results);
            }
        })
    });
}