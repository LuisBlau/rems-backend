const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes
var bodyParser = require('body-parser');
const { InsertAuditEntry } = require("../middleware/auditLogger");
const moment = require("moment/moment");

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();
var dataDestination = { location: 'pas_mongo_database', database: 'pas_config', collection: 'bus-monitor' }

module.exports = function (app) {
    app.get('/bus-monitor/getAll', (req, res) => {
        console.log("Get /bus-monitor/getAll called")
        const containers = azureClient.db("pas_software_distribution").collection("bus-monitor");
        containers.find().toArray(function (err, containerList) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!containerList) {
                const msg = { "message": "Stores: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            }
            else {
                res.status(statusCode.OK).json(containerList);
            }
        });
    })

    app.delete('/bus-monitor/cleanUpOldContainers', (req, res) => {
        console.log("Delete /bus-monitor/cleanUpOldContainers called")
        const containers = azureClient.db("pas_software_distribution").collection("bus-monitor");
        let weekAgo = new Date(moment().subtract(1, 'weeks'))
        let errorOccured = false
        containers.deleteMany({ LastUpdatedSec: { $exists: false } }, function (err, result) {
            if (err) {
                errorOccured = true
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                errorOccured = true
                const msg = { "message": "Bus Monitor: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                InsertAuditEntry('delete', result, 'delete', req.cookies.user, dataDestination)
            }
        })
        containers.deleteMany({ LastUpdatedSec: { $lte: weekAgo } }, function (err, result) {
            if (err) {
                errorOccured = true
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!result) {
                errorOccured = true
                const msg = { "message": "Bus Monitor: Error reading from server" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                InsertAuditEntry('delete', result, 'delete', req.cookies.user, dataDestination)
            }
        })
        if (!errorOccured) {
            res.status(statusCode.OK).json({ accepted: true })
        }
    })
}