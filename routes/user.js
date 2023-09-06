const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes
var bodyParser = require('body-parser');
const { InsertAuditEntry } = require("../middleware/auditLogger");

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();
var dataDestination = { location: 'pas_mongo_database', database: 'pas_config', collection: 'user' }

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
                InsertAuditEntry('update', updateResult.value, updateSet, request.cookies.user, dataDestination)
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
        userToUpdate.findOneAndUpdate(userQuery, updateSet, function (error, updateResult) {
            if (error) {
                console.log("Update error : ", error)
                const msg = { "message": "Error updating retailer configuration" }
                updateWasGood = false
                response.status(statusCode.INTERNAL_SERVER_ERROR).json(msg);
                throw (error)
            }
            if (updateResult) {
                InsertAuditEntry('update', updateResult.value, updateSet, request.cookies.user, dataDestination)
            }
            if (updateWasGood) {
                response.status(statusCode.OK).json({ "message": "SUCCESS" });
                return
            }
        })
    });

    app.delete("/user/delete", bodyParser.json(), async (req, res) => {
        console.log("/user/delete received with: ", req.query)
        const email = req.query?.email;
        const authUserEmail = req.query?.authUserEmail;
        var authUser = await azureClient.db("pas_config").collection("user").findOne({ email: authUserEmail });
        if (authUser && authUser?.role?.length > 0) {
            if (!authUser?.role?.includes('toshibaAdmin')) {
                res.status(401).send({ error: "Requesting user cannot delete users." });
                return;
            }
        } else {
            res.status(401).send({ error: "Logged user not found" });
            return;
        }

        if (!email) {
            res.status(400).send({ error: "Bad request, email is missing." });
            return;
        }

        var users = azureClient.db("pas_config").collection("user");

        try {
            const result = await users.deleteOne({ email: email });
            if (result.deletedCount === 1) {
                res.status(200).send({ message: "User successfully deleted from the database." });
            } else {
                res.status(404).send({ error: "User not found in the database." });
            }
        } catch (error) {
            res.status(500).send({ error: "An error occurred when trying to delete the user from the database." });
            console.error(error);
        }
    });

    app.post('/user/insert', bodyParser.json(), (req, res) => {
        console.log('/user/insert with: ', req.body)
        var users = azureClient.db("pas_config").collection("user");
        users.findOne({ email: req.body["userEmail"] }).then((result) => {
            if (result !== null) {
                const msg = { "error": 'User already exists!' }
                res.status(statusCode.CONFLICT).json(msg)
                res.send()
            } else {
                var newUserToInsert = {
                    email: req.body.userEmail,
                    firstName: req.body?.firstName,
                    lastName: req.body?.lastName,
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
                        InsertAuditEntry('insert', null, newUserToInsert, req.cookies.user, dataDestination)
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