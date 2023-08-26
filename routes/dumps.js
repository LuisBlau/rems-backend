const mongodb = require("mongodb")
const statusCode = require('http-status-codes').StatusCodes

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.get('/dumps/getDumps', (req, res) => {
        console.log('/dumps/getDumps called with: ', req.query)
        if (req.query["tenantId"] === null) {
            var results = []
            var filter = { "Retailer": req.cookies["retailerId"] };

            if (req.query["store"] != undefined && req.query["store"] != 'undefined') {
                filter.Store = req.query['store']
            }

            var snapshots = azureClient.db("pas_reloads").collection("dumps");
            let query = { "Retailer": req.cookies["retailerId"] }
            if ("Store" in req.query) query["Store"] = req.query["Store"]
            snapshots.find(query).toArray(function (err, result) {
                results = result;
                let modifiedResults = []
                for (var x of results) {
                    var y = x

                    y["Download"] = x["location"]["URL"]
                    y["Version"] = x["values"]["Version"]
                    y["Reason"] = x["values"]["Reason"]
                    if (x["RegNum"]) {
                        y["System"] = "Register " + x["RegNum"]
                    } else {
                        y["System"] = x["values"]["Controller ID"]
                    }
                    y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
                    y["ExtractType"] = x["values"]["ExtractType"]
                    y["State"] = x["values"]["State"]
                    y["Rids"] = x["values"]["rids"]

                    modifiedResults.push(y)
                }
                res.send(modifiedResults)
            });
        } else {
            var results = []
            if (req.query["retailerId"] !== 'null') {
                var filter = { "Retailer": req.query["retailerId"], "tenant_id": req.query["tenantId"] };
                if (req.query["store"] !== undefined && req.query["store"] !== 'undefined') {
                    filter.Store = req.query['store']
                }

                var snapshots = azureClient.db("pas_reloads").collection("dumps");
                snapshots.find(filter).toArray(function (err, result) {
                    results = result;
                    let modifiedResults = []
                    for (var x of results) {
                        var y = x

                        y["Download"] = x["location"]["URL"]
                        y["Version"] = x["values"]["Version"]
                        y["Reason"] = x["values"]["Reason"]
                        if (x["RegNum"]) {
                            y["System"] = "Register " + x["RegNum"]
                        } else {
                            y["System"] = x["values"]["Controller ID"]
                        }
                        y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
                        y["ExtractType"] = x["values"]["ExtractType"]
                        y["State"] = x["values"]["State"]
                        y["Rids"] = x["values"]["rids"]

                        modifiedResults.push(y)
                    }
                    res.send(modifiedResults)
                });
            }
        }
    });

    app.get('/dumps/getDumpsForStore', (req, res) => {
        console.log('/dumps/getDumpsForStore with: ', req.query)
        var snapshots = azureClient.db("pas_reloads").collection("dumps");
        let query = {}
        if (req.query["tenantId"] === undefined) {
            query = { Retailer: req.query.retailerId, Store: req.query.storeName }
        } else {
            query = { Retailer: req.query.retailerId, Store: req.query.storeName, tenant_id: req.query.tenantId }
        }
        snapshots.find(query).toArray(function (err, results) {
            if (err) {
                const msg = { "error": err }
                res.status(statusCode.INTERNAL_SERVER_ERROR).json(msg)
                throw err
            } else if (!results) {
                const msg = { "message": "No dumps found for store" }
                res.status(statusCode.NO_CONTENT).json(msg);
            } else {
                let modifiedResults = []
                for (var x of results) {
                    var y = x

                    y["Download"] = x["location"]["URL"]
                    y["Version"] = x["values"]["Version"]
                    y["Reason"] = x["values"]["Reason"]
                    if (x["RegNum"]) {
                        y["System"] = "Register " + x["RegNum"]
                    } else {
                        y["System"] = x["values"]["Controller ID"]
                    }
                    y["SBreqLink"] = "/api/registers/extracts/" + btoa(unescape(encodeURIComponent(JSON.stringify(x).replace("/\s\g", ""))))
                    y["ExtractType"] = x["values"]["ExtractType"]
                    y["State"] = x["values"]["State"]
                    y["Rids"] = x["values"]["rids"]

                    modifiedResults.push(y)
                }
                res.send(modifiedResults)
            }
        })
    });
}