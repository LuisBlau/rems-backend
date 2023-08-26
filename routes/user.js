const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes
var bodyParser = require('body-parser');

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.post('/user/settingsSubmission', bodyParser.json(), (request, response) => {
        let updateWasGood = true
        const receivedObject = request.body
        const userQuery = { email: receivedObject.email }
        const updateSet = { $set: { firstName: receivedObject.firstName, lastName: receivedObject.lastName, userDefinedMapConfig: receivedObject.userDefinedMapConfig } }

        const userToUpdate = azureClient.db("pas_config").collection("user");
        userToUpdate.updateOne(userQuery, updateSet, function (error, updateResult) {
            if (error) {
                console.log("Update error: ", error)
                const msg = { "message": "Error updating retailer configuration" }
                updateWasGood = false
                response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw (error)
            }
            if (updateResult) {
                const responseInfo =
                    "User with email: " + receivedObject.email + " was updated to be " + receivedObject.firstName + " " + receivedObject.lastName
                console.log("Update of user was SUCCESS : ", responseInfo)
            }
            if (updateWasGood) {
                response.status(statusCode.OK).json({ "message": "SUCCESS" });
                return
            }
        })
    });

    app.post('/user/managementSubmission', bodyParser.json(), (request, response) => {
        let updateWasGood = true
        const receivedObject = request.body
        const userQuery = { email: receivedObject.user.email }
        const updateSet = { $set: { retailer: receivedObject.retailers, role: receivedObject.roles } }

        const userToUpdate = azureClient.db("pas_config").collection("user");
        userToUpdate.updateOne(userQuery, updateSet, function (error, updateResult) {
            if (error) {
                console.log("Update error : ", error)
                const msg = { "message": "Error updating retailer configuration" }
                updateWasGood = false
                response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw (error)
            }
            if (updateResult) {
                const responseInfo =
                    "User with email: " + receivedObject.user.email + " was updated."
                console.log("Update of user was SUCCESS : ", responseInfo)
            }
            if (updateWasGood) {
                response.status(statusCode.OK).json({ "message": "SUCCESS" });
                return
            }
        })
    });

    app.post('/user/insert', (req, res) => {
        console.log('/user/insert with: ', req.query)
        var users = azureClient.db("pas_config").collection("user");
        users.findOne({ email: req.query["userEmail"] }).then((result) => {
            if (result !== null) {
                const msg = { "error": 'User already exists!' }
                res.status(statusCode.CONFLICT).json(msg)
                res.send()
            } else {
                var newUserToInsert = {
                    email: req.query["userEmail"],
                    retailer: [],
                    role: [],
                    userDefinedMapConfig: ""
                }
                users.insertOne(newUserToInsert, function (err, result) {
                    if (err) {
                        const msg = { "error": err }
                        res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                        throw err;
                    } else {
                        const msg = { "message": "Success" }
                        res.status(statusCode.OK).json(msg);
                    }
                    res.send()
                })
            }
        })
    })

    app.get('/user/getRoleDetails', (req, res) => {
        var results = {}
        var userRoles = azureClient.db("pas_config").collection("user");
        userRoles.find({ email: { '$regex': req.query.email, $options: 'i' } }).limit(1).toArray(function (err, result) {

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

    app.get('/user/getDetails', (req, res) => {
        var results = {}
        var userDetails = azureClient.db("pas_config").collection("user");
        userDetails.find({ email: { '$regex': req.query.email, $options: 'i' } }).limit(1).toArray(function (err, result) {

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

    app.get('/user/getAllUserDetails', (req, res) => {
        var userDetails = azureClient.db("pas_config").collection("user");
        userDetails.find().toArray(function (err, result) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            }
            res.send(result)
        });
    });
}