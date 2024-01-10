const bodyParser = require("body-parser");
const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes
var { ObjectId } = require('mongodb')
const { InsertAuditEntry } = require('../middleware/auditLogger');
var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.get('/alerts/getForStore', (req, res) => {
        console.log("Get /REMS/stores/alerts received : ", req.query)
        const alerts = azureClient.db("pas_availability").collection("alerts");
        if (req.query["tenantId"] === undefined) {
            alerts.find({ retailer_id: req.query.retailerId, store: req.query.storeName, type: "Alert" }).toArray(function (err, pasAvailability) {
                if (err) {
                    const msg = { "error": err }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err
                } else if (!pasAvailability) {
                    const msg = { "message": "Rems: Error reading from server" }
                    res.status(statusCode.NO_CONTENT).json(msg);
                }
                else {
                    // console.log("sending alerts info : ", pasAvailability)
                    res.status(statusCode.OK).json(pasAvailability);
                }
            });
        } else {
            alerts.find({ retailer_id: req.query.retailerId, store: req.query.storeName, tenant_id: req.query.tenantId, type: "Alert" }).toArray(function (err, pasAvailability) {
                if (err) {
                    const msg = { "error": err }
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                    throw err
                } else if (!pasAvailability) {
                    const msg = { "message": "Rems: Error reading from server" }
                    res.status(statusCode.NO_CONTENT).json(msg);
                }
                else {
                    // console.log("sending alerts info : ", pasAvailability)
                    res.status(statusCode.OK).json(pasAvailability);
                }
            });
        }

    });

    app.put('/alerts/:alertId', bodyParser.json(), (req, res) => {
        console.log('/alerts/:alertId received with: ', req.body)
        const alertId = req.params.alertId;

        const alertKeep = req.body.alertKeep;
        const eventCreated = req.body.eventCreated;

        const alerts = azureClient.db("pas_availability").collection("alerts");

        try {
            const updateQuery = {
                _id: ObjectId(alertId),
            };

            var updateOperation;
            if(alertKeep != null){
                const updateFields = {
                    alertKeep: alertKeep,
                };
    
                // If newStatus is true add the dateTimeFlagged field with the date provided
                if (alertKeep === false) {
                    const dateTimeFlagged = req.body.dateTimeFlagged;
                    if (dateTimeFlagged) {
                        updateFields.dateTimeFlagged = dateTimeFlagged;
                    }
                } else {
                    updateFields.dateTimeFlagged = undefined;
                }
    
                updateOperation = {
                    $set: updateFields,
                };
            }else if (eventCreated != null && eventCreated){
                const updateFields = {
                    eventCreated: eventCreated,
                    automaticSNOWEvent: false
                };
    
                updateOperation = {
                    $set: updateFields,
                };
            }

            alerts.updateOne(updateQuery, updateOperation, (error, result) => {
                if (error) {
                    console.error('MongoDB update error:', error);
                    res.status(statusCode.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
                } else if (result.matchedCount === 1) {
                    InsertAuditEntry('update', result.value, updateOperation, req.cookies.user, { location: 'pas_mongo_database', database: 'pas_availability', collection: 'alerts' })
                    res.status(statusCode.OK).json({ message: 'document updated successfully' });
                } else {
                    res.status(statusCode.NO_CONTENT).json({ message: 'No matching document found' });
                }
            });
        } catch (exception) {
            console.error('Exception:', exception);
            res.status(statusCode.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
        }
    });
}